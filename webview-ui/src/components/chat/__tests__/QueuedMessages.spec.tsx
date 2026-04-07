import { fireEvent, render, screen } from "@/utils/test-utils";

import { QueuedMessages } from "../QueuedMessages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || key,
  }),
}));

vi.mock("../Mention", () => ({
  Mention: ({ text }: { text: string }) => <span>{text}</span>,
}));

describe("QueuedMessages", () => {
  it("renders queued messages with the frosted panel styling", () => {
    const { container } = render(
      <QueuedMessages
        queue={[{ id: "msg-1", text: "queued text", timestamp: Date.now() }]}
        onRemove={vi.fn()}
        onSendNow={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("1 message queued")).toBeInTheDocument();
    expect(container.querySelector(".backdrop-blur-md")).toBeInTheDocument();
  });

  it("calls onSendNow for the selected queued message", () => {
    const onSendNow = vi.fn();

    render(
      <QueuedMessages
        queue={[
          { id: "msg-1", text: "first queued", timestamp: Date.now() },
          { id: "msg-2", text: "second queued", timestamp: Date.now() + 1 },
        ]}
        onRemove={vi.fn()}
        onSendNow={onSendNow}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByTitle("Send now")[1]);

    expect(onSendNow).toHaveBeenCalledWith("msg-2");
  });

  it("calls onRemove and onUpdate with the message id", () => {
    const onRemove = vi.fn();
    const onUpdate = vi.fn();

    render(
      <QueuedMessages
        queue={[{ id: "msg-1", text: "first queued", timestamp: Date.now() }]}
        onRemove={onRemove}
        onSendNow={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove queued message"));
    fireEvent.click(screen.getByText("first queued"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "updated queued text" },
    });
    fireEvent.blur(screen.getByRole("textbox"));

    expect(onRemove).toHaveBeenCalledWith("msg-1");
    expect(onUpdate).toHaveBeenCalledWith("msg-1", "updated queued text");
  });
});
