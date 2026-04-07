import { describe, expect, it } from "vitest";

import { MessageQueueService } from "../MessageQueueService";

describe("MessageQueueService", () => {
  it("emits a snapshot instead of the live backing array", () => {
    const service = new MessageQueueService();
    const snapshots: string[][] = [];

    service.on("stateChanged", (messages) => {
      snapshots.push(messages.map((message) => message.text));
    });

    service.addMessage("first");
    const exposedMessages = service.messages;
    exposedMessages.push({
      timestamp: Date.now(),
      id: "external-mutation",
      text: "mutated",
    } as any);

    expect(snapshots).toEqual([["first"]]);
    expect(service.messages.map((message) => message.text)).toEqual(["first"]);
  });

  it("moves a queued message to the front without dropping it", () => {
    const service = new MessageQueueService();
    const first = service.addMessage("first");
    const second = service.addMessage("second");
    const third = service.addMessage("third");

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();

    const moved = service.moveMessageToFront(third!.id);

    expect(moved).toBe(true);
    expect(service.messages.map((message) => message.text)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("dequeues a specific queued message by id", () => {
    const service = new MessageQueueService();
    const first = service.addMessage("first");
    const second = service.addMessage("second");
    const third = service.addMessage("third");

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();

    const dequeued = service.dequeueMessageById(second!.id);

    expect(dequeued?.text).toBe("second");
    expect(service.messages.map((message) => message.text)).toEqual([
      "first",
      "third",
    ]);
  });

  it("does not emit a state change when dequeuing an empty queue", () => {
    const service = new MessageQueueService();
    const stateChanged = vi.fn();

    service.on("stateChanged", stateChanged);

    const dequeued = service.dequeueMessage();

    expect(dequeued).toBeUndefined();
    expect(stateChanged).not.toHaveBeenCalled();
  });

  it("does not emit a state change when updateMessage is a no-op", () => {
    const service = new MessageQueueService();
    const stateChanged = vi.fn();
    const message = service.addMessage("first", ["image-1"]);

    expect(message).toBeDefined();

    service.on("stateChanged", stateChanged);

    const updated = service.updateMessage(message!.id, "first", ["image-1"]);

    expect(updated).toBe(false);
    expect(stateChanged).not.toHaveBeenCalled();
  });
});
