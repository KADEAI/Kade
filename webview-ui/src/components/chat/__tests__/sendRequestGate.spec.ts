import { createSendRequestGate } from "../sendRequestGate";

describe("sendRequestGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks overlapping send requests until the lock clears", () => {
    const gate = createSendRequestGate();
    const onSend = vi.fn();

    expect(gate.requestSend(onSend)).toBe(true);
    expect(gate.requestSend(onSend)).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(gate.requestSend(onSend)).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
