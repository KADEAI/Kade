import { fireEvent, render, screen } from "@/utils/test-utils";
import { BackgroundSettings } from "../BackgroundSettings";

const mockRefreshBackgroundOptions = vi.fn();
const mockOpenBackgroundFolder = vi.fn();

vi.mock("@/hooks/useEmptyStateBackgrounds", () => ({
  useEmptyStateBackgrounds: () => ({
    folderPath: "/tmp/empty-state-backgrounds",
    options: [
      {
        file: "aurora.png",
        label: "aurora",
        uri: "vscode-webview://aurora.png",
      },
      {
        file: "forest.jpg",
        label: "forest",
        uri: "vscode-webview://forest.jpg",
      },
    ],
    isLoading: false,
    error: null,
    refresh: mockRefreshBackgroundOptions,
    openFolder: mockOpenBackgroundFolder,
  }),
}));

describe("BackgroundSettings", () => {
  const mockSetCachedStateField = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the background sections", () => {
    render(
      <BackgroundSettings setCachedStateField={mockSetCachedStateField} />,
    );

    expect(screen.getByText("Background Gallery")).toBeInTheDocument();
    expect(screen.getByText("Tool Header Backgrounds")).toBeInTheDocument();
    expect(screen.getByText("Chat background")).toBeInTheDocument();
  });

  it("calls setCachedStateField when a chat background is selected", () => {
    render(
      <BackgroundSettings
        chatBackground=""
        setCachedStateField={mockSetCachedStateField}
      />,
    );

    const chatBackgroundSection = document.querySelector(
      '[data-setting-id="display-chat-background"]',
    );
    const forestButton = Array.from(
      chatBackgroundSection?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("forest.jpg"));

    expect(forestButton).toBeTruthy();
    fireEvent.click(forestButton as HTMLButtonElement);

    expect(mockSetCachedStateField).toHaveBeenCalledWith(
      "chatBackground",
      "forest.jpg",
    );
  });

  it("selects an empty state background image", () => {
    const { container } = render(
      <BackgroundSettings
        emptyStateBackground=""
        setCachedStateField={mockSetCachedStateField}
      />,
    );

    const homeBackgroundSections = container.querySelectorAll(
      '[data-setting-id="display-empty-state-background"]',
    );
    const homeBackgroundSection =
      homeBackgroundSections[homeBackgroundSections.length - 1];
    const forestButton = Array.from(
      homeBackgroundSection?.querySelectorAll("button") ?? [],
    ).find(
      (button) =>
        button.textContent?.includes("forest") &&
        button.textContent?.includes("forest.jpg"),
    );

    fireEvent.click(forestButton as HTMLButtonElement);

    expect(mockSetCachedStateField).toHaveBeenCalledWith(
      "emptyStateBackground",
      "forest.jpg",
    );
  });

  it("opens the empty state background folder", () => {
    render(
      <BackgroundSettings setCachedStateField={mockSetCachedStateField} />,
    );

    fireEvent.click(screen.getByText("Open Folder"));

    expect(mockOpenBackgroundFolder).toHaveBeenCalled();
  });

  it("refreshes empty state background options", () => {
    render(
      <BackgroundSettings setCachedStateField={mockSetCachedStateField} />,
    );

    fireEvent.click(screen.getByText("Refresh"));

    expect(mockRefreshBackgroundOptions).toHaveBeenCalled();
  });
});
