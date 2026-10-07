export const FOUNDATION_INTERFACE_VERSION = 1 as const;
export type FoundationErrorCode = 1 | 2;

export interface FoundationState {
  initializer: string;
  stateVersion: number;
}

export interface FoundationContractReader {
  interfaceVersion(): Promise<number>;
  version(): Promise<number>;
  state(): Promise<FoundationState>;
}

export class UnsupportedFoundationInterfaceError extends Error {
  constructor(readonly receivedVersion: number) {
    super(
      "Unsupported Orrylo foundation interface version: " +
        receivedVersion +
        ". Expected interface version 1.",
    );
    this.name = "UnsupportedFoundationInterfaceError";
  }
}

export interface KnownFoundationError {
  code: FoundationErrorCode;
  name: "AlreadyInitialized" | "StateUnavailable";
  message: string;
}

const KNOWN_ERRORS: Record<FoundationErrorCode, KnownFoundationError> = {
  1: {
    code: 1,
    name: "AlreadyInitialized",
    message: "Foundation initialization guard detected existing state.",
  },
  2: {
    code: 2,
    name: "StateUnavailable",
    message: "Foundation state is unavailable.",
  },
};

export function assertFoundationInterfaceCompatible(
  interfaceVersion: number,
): asserts interfaceVersion is typeof FOUNDATION_INTERFACE_VERSION {
  if (interfaceVersion !== FOUNDATION_INTERFACE_VERSION) {
    throw new UnsupportedFoundationInterfaceError(interfaceVersion);
  }
}

export function mapFoundationContractError(
  code: number,
): KnownFoundationError | null {
  return code === 1 || code === 2 ? KNOWN_ERRORS[code] : null;
}

export interface CompatibleFoundationSnapshot {
  interfaceVersion: typeof FOUNDATION_INTERFACE_VERSION;
  stateVersion: number;
  state: FoundationState;
}

export async function readCompatibleFoundationSnapshot(
  reader: FoundationContractReader,
): Promise<CompatibleFoundationSnapshot> {
  const interfaceVersion = await reader.interfaceVersion();
  assertFoundationInterfaceCompatible(interfaceVersion);

  const [stateVersion, state] = await Promise.all([
    reader.version(),
    reader.state(),
  ]);

  return { interfaceVersion, stateVersion, state };
}
