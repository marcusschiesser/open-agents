export const SANDBOX_TYPES = ["daytona", "vercel"] as const;

export type AppSandboxType = (typeof SANDBOX_TYPES)[number];

export const DEFAULT_APP_SANDBOX_TYPE: AppSandboxType = "daytona";

export function isAppSandboxType(value: unknown): value is AppSandboxType {
  return (
    typeof value === "string" && SANDBOX_TYPES.includes(value as AppSandboxType)
  );
}
