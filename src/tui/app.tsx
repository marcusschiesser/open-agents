import React, { useEffect, useState, useCallback, useMemo, memo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  isToolUIPart,
  getToolName,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { renderMarkdown } from "./lib/markdown.js";
import { useChatContext } from "./chat-context.js";
import { ToolCall } from "./components/tool-call.js";
import { StatusBar } from "./components/status-bar.js";
import { InputBox } from "./components/input-box.js";
import { Header } from "./components/header.js";
import { pasteCollapseLineThreshold, tuiAgentModelId } from "./config.js";
import type {
  TUIOptions,
  TUIAgentUIMessagePart,
  TUIAgentUIMessage,
  TUIAgentUIToolPart,
} from "./types.js";

type AppProps = {
  options: TUIOptions;
};

const TextPart = memo(function TextPart({ text }: { text: string }) {
  const rendered = useMemo(() => renderMarkdown(text), [text]);

  return (
    <Box>
      <Text>● {rendered}</Text>
    </Box>
  );
});

const ReasoningPart = memo(function ReasoningPart({ text }: { text: string }) {
  return (
    <Box marginLeft={2}>
      <Text color="gray" dimColor wrap="wrap">
        {text}
      </Text>
    </Box>
  );
});

function ToolPartWrapper({
  part,
  activeApprovalId,
}: {
  part: TUIAgentUIToolPart;
  activeApprovalId: string | null;
}) {
  return <ToolCall part={part} activeApprovalId={activeApprovalId} />;
}

function renderPart(
  part: TUIAgentUIMessagePart,
  key: string,
  activeApprovalId: string | null,
) {
  if (isToolUIPart(part)) {
    return (
      <ToolPartWrapper key={key} part={part} activeApprovalId={activeApprovalId} />
    );
  }

  switch (part.type) {
    case "text":
      if (!part.text) return null;
      return <TextPart key={key} text={part.text} />;

    case "reasoning":
      if (!part.text) return null;
      return <ReasoningPart key={key} text={part.text} />;

    default:
      return null;
  }
}

const UserMessage = memo(function UserMessage({
  message,
}: {
  message: TUIAgentUIMessage;
}) {
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");

  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color="magenta" bold>
        &gt;{" "}
      </Text>
      <Text color="white" bold>
        {text}
      </Text>
    </Box>
  );
});

const AssistantMessage = memo(function AssistantMessage({
  message,
  activeApprovalId,
}: {
  message: TUIAgentUIMessage;
  activeApprovalId: string | null;
}) {
  return (
    <Box flexDirection="column">
      {message.parts.map((part, index) =>
        renderPart(part, `${message.id}-${index}`, activeApprovalId),
      )}
    </Box>
  );
});

const Message = memo(function Message({
  message,
  activeApprovalId,
}: {
  message: TUIAgentUIMessage;
  activeApprovalId: string | null;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessage message={message} activeApprovalId={activeApprovalId} />
    );
  }
  return null;
});

const MessagesList = memo(function MessagesList({
  messages,
  activeApprovalId,
}: {
  messages: TUIAgentUIMessage[];
  activeApprovalId: string | null;
}) {
  return (
    <Box flexDirection="column">
      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          activeApprovalId={activeApprovalId}
        />
      ))}
    </Box>
  );
});

const ErrorDisplay = memo(function ErrorDisplay({
  error,
}: {
  error: Error | undefined;
}) {
  if (!error) return null;
  return (
    <Box marginTop={1}>
      <Text color="red">Error: {error.message}</Text>
    </Box>
  );
});

function useStatusText(messages: TUIAgentUIMessage[]): string {
  return useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (let i = lastMessage.parts.length - 1; i >= 0; i--) {
        const p = lastMessage.parts[i];
        if (
          p &&
          isToolUIPart(p) &&
          (p.state === "input-available" || p.state === "input-streaming")
        ) {
          return `${getToolName(p)}...`;
        }
      }
    }
    return "Thinking...";
  }, [messages]);
}

const StreamingStatusBar = memo(function StreamingStatusBar({
  messages,
  startTime,
}: {
  messages: TUIAgentUIMessage[];
  startTime: number | null;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const statusText = useStatusText(messages);

  useEffect(() => {
    if (startTime) {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      const timer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [startTime]);

  return (
    <StatusBar
      isStreaming={true}
      elapsedSeconds={elapsedSeconds}
      status={statusText}
    />
  );
});

const InterruptedIndicator = memo(function InterruptedIndicator() {
  return (
    <Box marginLeft={2}>
      <Text color="gray">└ </Text>
      <Text color="yellow">Interrupted</Text>
      <Text color="gray"> · What should the agent do instead?</Text>
    </Box>
  );
});

export function App({ options }: AppProps) {
  const { exit } = useApp();
  const { chat, state, cycleAutoAcceptMode } = useChatContext();
  const [startTime, setStartTime] = useState<number | null>(null);
  const [wasInterrupted, setWasInterrupted] = useState(false);

  const { messages, sendMessage, status, stop, error } = useChat({
    chat,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Clear interrupted state when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setWasInterrupted(false);
    }
  }, [isStreaming]);

  const { hasPendingApproval, activeApprovalId } = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (const p of lastMessage.parts) {
        if (isToolUIPart(p) && p.state === "approval-requested") {
          const approval = (p as { approval?: { id: string } }).approval;
          return {
            hasPendingApproval: true,
            activeApprovalId: approval?.id ?? null,
          };
        }
      }
    }
    return { hasPendingApproval: false, activeApprovalId: null };
  }, [messages]);

  useInput((input, key) => {
    if (key.escape && isStreaming) {
      stop();
      setWasInterrupted(true);
    }
    if (input === "c" && key.ctrl) {
      stop();
      exit();
    }
  });

  useEffect(() => {
    if (options?.initialPrompt) {
      setStartTime(Date.now());
      sendMessage({ text: options.initialPrompt });
    }
  }, []);

  const handleSubmit = useCallback(
    (prompt: string) => {
      if (!isStreaming) {
        setStartTime(Date.now());
        sendMessage({ text: prompt });
      }
    },
    [isStreaming, sendMessage],
  );

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Header
        name={options?.header?.name}
        version={options?.header?.version}
        model={options?.header?.model ?? tuiAgentModelId}
        cwd={state.workingDirectory}
      />

      <MessagesList messages={messages} activeApprovalId={activeApprovalId} />

      {wasInterrupted && !isStreaming && <InterruptedIndicator />}

      <ErrorDisplay error={error} />

      {isStreaming && (
        <StreamingStatusBar messages={messages} startTime={startTime} />
      )}

      {!hasPendingApproval && (
        <InputBox
          onSubmit={handleSubmit}
          autoAcceptMode={state.autoAcceptMode}
          onToggleAutoAccept={cycleAutoAcceptMode}
          disabled={isStreaming}
          inputTokens={state.usage.inputTokens ?? 0}
          contextLimit={state.contextLimit}
          pasteCollapseLineThreshold={pasteCollapseLineThreshold}
        />
      )}
    </Box>
  );
}
