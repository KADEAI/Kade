import { EventEmitter } from "events";

import { v4 as uuidv4 } from "uuid";

import { QueuedMessage } from "@roo-code/types";

export interface MessageQueueState {
  messages: QueuedMessage[];
  isProcessing: boolean;
  isPaused: boolean;
}

export interface QueueEvents {
  stateChanged: [messages: QueuedMessage[]];
}

export class MessageQueueService extends EventEmitter<QueueEvents> {
  private _messages: QueuedMessage[];

  constructor() {
    super();

    this._messages = [];
  }

  private findMessage(id: string) {
    const index = this._messages.findIndex((msg) => msg.id === id);

    if (index === -1) {
      return { index, message: undefined };
    }

    return { index, message: this._messages[index] };
  }

  public addMessage(
    text: string,
    images?: string[],
  ): QueuedMessage | undefined {
    if (!text && !images?.length) {
      return undefined;
    }

    const message: QueuedMessage = {
      timestamp: Date.now(),
      id: uuidv4(),
      text,
      images,
    };

    this._messages.push(message);
    this.emit("stateChanged", [...this._messages]);

    return message;
  }

  public removeMessage(id: string): boolean {
    const { index, message } = this.findMessage(id);

    if (!message) {
      return false;
    }

    this._messages.splice(index, 1);
    this.emit("stateChanged", [...this._messages]);
    return true;
  }

  public updateMessage(id: string, text: string, images?: string[]): boolean {
    const { message } = this.findMessage(id);

    if (!message) {
      return false;
    }

    const hasTextChanged = message.text !== text;
    const hasImagesChanged =
      JSON.stringify(message.images ?? []) !== JSON.stringify(images ?? []);

    if (!hasTextChanged && !hasImagesChanged) {
      return false;
    }

    message.timestamp = Date.now();
    message.text = text;
    message.images = images;
    this.emit("stateChanged", [...this._messages]);
    return true;
  }

  public dequeueMessage(): QueuedMessage | undefined {
    const message = this._messages.shift();

    if (!message) {
      return undefined;
    }

    this.emit("stateChanged", [...this._messages]);
    return message;
  }

  public dequeueMessageById(id: string): QueuedMessage | undefined {
    const { index, message } = this.findMessage(id);

    if (!message) {
      return undefined;
    }

    this._messages.splice(index, 1);
    this.emit("stateChanged", [...this._messages]);
    return message;
  }

  public moveMessageToFront(id: string): boolean {
    const { index, message } = this.findMessage(id);

    if (!message) {
      return false;
    }

    if (index === 0) {
      return true;
    }

    this._messages.splice(index, 1);
    this._messages.unshift(message);
    this.emit("stateChanged", [...this._messages]);
    return true;
  }

  public get messages(): QueuedMessage[] {
    return [...this._messages];
  }

  public isEmpty(): boolean {
    return this._messages.length === 0;
  }

  public dispose(): void {
    this._messages = [];
    this.removeAllListeners();
  }
}
