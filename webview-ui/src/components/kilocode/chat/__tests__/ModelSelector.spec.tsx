import { fireEvent, render, screen } from "@/utils/test-utils";
import { ModelSelector } from "../ModelSelector";
import type { ProviderSettings } from "@roo-code/types";

type MockKiloCreditBalanceResult = {
  data: number | null;
  isLoading: boolean;
  error?: string | null;
};

let localStorageStore: Record<string, string> = {};

Object.defineProperty(window, "localStorage", {
  writable: true,
  value: {
    getItem: (key: string) => localStorageStore[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageStore[key];
    },
    clear: () => {
      localStorageStore = {};
    },
  },
});

vi.mock("@/utils/vscode", () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}));

vi.mock("@/i18n/TranslationContext", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockUsePreferredModels = vi.fn(() => ["model-1", "model-2"]);
const mockUseKiloCreditBalance = vi.fn(
  (_enabled?: boolean): MockKiloCreditBalanceResult => ({
    data: null,
    isLoading: false,
    error: null,
  }),
);

vi.mock("@/components/ui/hooks/kilocode/usePreferredModels", () => ({
  usePreferredModels: () => mockUsePreferredModels(),
}));

vi.mock("@/components/ui/hooks/useKiloCreditBalance", () => ({
  useKiloCreditBalance: (enabled?: boolean) => mockUseKiloCreditBalance(enabled),
}));

// Create a mock function that can be controlled per test
const mockUseProviderModels = vi.fn();

vi.mock("../../hooks/useProviderModels", () => ({
  useProviderModels: (config: ProviderSettings) =>
    mockUseProviderModels(config),
}));

vi.mock("../../hooks/useSelectedModel", () => ({
  getSelectedModelId: () => "model-1",
  getModelIdKey: () => "apiModelId",
}));

describe("ModelSelector", () => {
  const baseApiConfiguration: ProviderSettings = {
    apiProvider: "openai",
    apiModelId: "model-1",
  };

  beforeEach(() => {
    window.localStorage.clear();
    // Reset mock before each test
    mockUseProviderModels.mockReset();
    mockUsePreferredModels.mockReset();
    mockUseKiloCreditBalance.mockReset();
    mockUsePreferredModels.mockReturnValue(["model-1", "model-2"]);
    mockUseKiloCreditBalance.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    // Default mock implementation
    mockUseProviderModels.mockReturnValue({
      provider: "openai",
      providerModels: {
        "model-1": { displayName: "Model 1" },
        "model-2": { displayName: "Model 2" },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });
  });

  test("renders dropdown for chat profile", () => {
    const chatConfig: ProviderSettings = {
      ...baseApiConfiguration,
      profileType: "chat",
    };

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={chatConfig}
        fallbackText="Select a model"
      />,
    );

    // Should render the SelectDropdown component (not a span)
    // The SelectDropdown renders as a button with data-testid="dropdown-trigger"
    const dropdownTrigger = screen.getByTestId("dropdown-trigger");
    expect(dropdownTrigger).toBeInTheDocument();
    expect(dropdownTrigger.tagName).toBe("BUTTON");
  });

  test("renders disabled span for autocomplete profile", () => {
    const autocompleteConfig: ProviderSettings = {
      ...baseApiConfiguration,
      profileType: "autocomplete",
    };

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={autocompleteConfig}
        fallbackText="Select a model"
      />,
    );

    // Should render a span with fallback text (not a dropdown)
    expect(screen.getByText("Select a model")).toBeInTheDocument();

    // Should NOT render the SelectDropdown component
    const dropdownTrigger = screen.queryByTestId("dropdown-trigger");
    expect(dropdownTrigger).not.toBeInTheDocument();
  });

  test("renders disabled span when isError is true", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "openai",
      providerModels: {},
      providerDefaultModel: undefined,
      isLoading: false,
      isError: true,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={baseApiConfiguration}
        fallbackText="Error loading models"
      />,
    );

    expect(screen.getByText("Error loading models")).toBeInTheDocument();

    const dropdownTrigger = screen.queryByTestId("dropdown-trigger");
    expect(dropdownTrigger).not.toBeInTheDocument();
  });

  test("renders nothing when isLoading is true", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "openai",
      providerModels: {},
      providerDefaultModel: undefined,
      isLoading: true,
      isError: false,
    });

    const { container } = render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={baseApiConfiguration}
        fallbackText="Loading..."
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("renders span for virtual-quota-fallback provider with virtualQuotaActiveModel", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "virtual-quota-fallback",
      providerModels: {},
      providerDefaultModel: undefined,
      isLoading: false,
      isError: false,
    });

    const virtualQuotaConfig: ProviderSettings = {
      ...baseApiConfiguration,
      apiProvider: "virtual-quota-fallback",
    };

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={virtualQuotaConfig}
        fallbackText="Select a model"
        virtualQuotaActiveModel={{ id: "gpt-4", name: "GPT-4" }}
      />,
    );

    // Should show the virtual quota active model name (prettyModelName formats it)
    expect(screen.getByText("GPT 4")).toBeInTheDocument();

    const dropdownTrigger = screen.queryByTestId("dropdown-trigger");
    expect(dropdownTrigger).not.toBeInTheDocument();
  });

  test("autocomplete profile takes precedence over other conditions", () => {
    // Even with valid models, autocomplete profile should show disabled span
    const autocompleteConfig: ProviderSettings = {
      ...baseApiConfiguration,
      profileType: "autocomplete",
    };

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={autocompleteConfig}
        fallbackText="Autocomplete model"
      />,
    );

    expect(screen.getByText("Autocomplete model")).toBeInTheDocument();

    const dropdownTrigger = screen.queryByTestId("dropdown-trigger");
    expect(dropdownTrigger).not.toBeInTheDocument();
  });

  test("shows pricing details for openrouter models in the dropdown", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "openrouter",
      providerModels: {
        "model-1": {
          displayName: "Model 1",
          inputPrice: 0.15,
          outputPrice: 0.6,
        },
        "model-2": {
          displayName: "Model 2",
          inputPrice: 2.5,
          outputPrice: 10,
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "openrouter",
          openRouterModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    expect(screen.getByText("$0.15|0.60")).toBeInTheDocument();
    expect(screen.getByText("$2.50|10.00")).toBeInTheDocument();
  });

  test("shows kilo credits in the dropdown search bar", () => {
    mockUseKiloCreditBalance.mockReturnValue({
      data: 13.25,
      isLoading: false,
    });
    mockUseProviderModels.mockReturnValue({
      provider: "kilocode",
      providerModels: {
        "model-1": { displayName: "Model 1" },
        "model-2": { displayName: "Model 2" },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "kilocode",
          kilocodeModel: "model-1",
          kilocodeToken: "test-token",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    expect(screen.getByText("Credits: $13.25")).toBeInTheDocument();
  });

  test("hides pricing entirely for zero-cost models", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "openrouter",
      providerModels: {
        "model-1": {
          displayName: "OAuth Model",
          inputPrice: 0,
          outputPrice: 0,
        },
        "model-2": {
          displayName: "Paid Model",
          inputPrice: 1,
          outputPrice: 2,
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "openrouter",
          openRouterModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    expect(
      screen.queryByTestId("model-zero-cost-indicator-model-1"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00|$0.00")).toBeNull();
    expect(screen.queryByText("$0.00|0.00")).toBeNull();
    expect(screen.getByText("$1.00|2.00")).toBeInTheDocument();
  });

  test("treats negative pricing metadata like a free model", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "openrouter",
      providerModels: {
        "model-1": {
          displayName: "Weird Model",
          inputPrice: -1,
          outputPrice: 2,
        },
        "model-2": {
          displayName: "Paid Model",
          inputPrice: 1,
          outputPrice: 2,
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "openrouter",
          openRouterModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    expect(screen.queryByText("-$1.00|2.00")).toBeNull();
    expect(screen.queryByText("$-1.00|2.00")).toBeNull();
    expect(screen.getByText("$1.00|2.00")).toBeInTheDocument();
  });

  test("hides Baseten provider prefixes in selector labels", () => {
    mockUseProviderModels.mockReturnValue({
      provider: "baseten",
      providerModels: {
        "model-1": {
          displayName: "Deepseek-ai / DeepSeek R1 0528",
        },
        "model-2": {
          displayName: "Moonshotai / Kimi K2 Thinking",
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "baseten",
          apiModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    expect(screen.getByTestId("dropdown-trigger")).toHaveTextContent(
      "DeepSeek R1 0528",
    );
    expect(screen.getByTestId("dropdown-trigger")).not.toHaveTextContent(
      "Deepseek-ai /",
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    expect(screen.getByText("Kimi K2 Thinking")).toBeInTheDocument();
    expect(screen.queryByText("Moonshotai / Kimi K2 Thinking")).toBeNull();
  });

  test("keeps the selected model pinned first while sorting the rest", () => {
    mockUsePreferredModels.mockReturnValue(["model-1", "model-2", "model-3"]);
    mockUseProviderModels.mockReturnValue({
      provider: "openrouter",
      providerModels: {
        "model-1": {
          displayName: "Bravo",
          inputPrice: 8,
          outputPrice: 7,
        },
        "model-2": {
          displayName: "Charlie",
          inputPrice: 0.2,
          outputPrice: 0.1,
        },
        "model-3": {
          displayName: "Alpha",
          inputPrice: 2,
          outputPrice: 3,
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "openrouter",
          openRouterModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    const sortButton = screen.getByTestId("model-sort-button");
    expect(sortButton).toHaveAttribute(
      "aria-label",
      "Model sort mode: Sort models alphabetically from A to Z",
    );
    expect(sortButton).toHaveTextContent("A");

    expect(screen.getAllByTestId("dropdown-item")[0]).toHaveTextContent("Bravo");
    expect(screen.getAllByTestId("dropdown-item")[1]).toHaveTextContent("Alpha");

    fireEvent.click(sortButton);
    expect(sortButton).toHaveAttribute(
      "aria-label",
      "Model sort mode: Sort models alphabetically from Z to A",
    );
    expect(sortButton).toHaveTextContent("Z");
    expect(screen.getAllByTestId("dropdown-item")[0]).toHaveTextContent("Bravo");
    expect(screen.getAllByTestId("dropdown-item")[1]).toHaveTextContent(
      "Charlie",
    );

    fireEvent.click(sortButton);
    expect(sortButton).toHaveAttribute(
      "aria-label",
      "Model sort mode: Sort models by lowest total price",
    );
    expect(sortButton).toHaveTextContent("$");
    expect(screen.getAllByTestId("dropdown-item")[0]).toHaveTextContent("Bravo");
    expect(screen.getAllByTestId("dropdown-item")[1]).toHaveTextContent(
      "Charlie",
    );

    fireEvent.click(sortButton);
    expect(sortButton).toHaveAttribute(
      "aria-label",
      "Model sort mode: Sort models by highest total price",
    );
    expect(sortButton).toHaveTextContent("$$");
    expect(screen.getAllByTestId("dropdown-item")[0]).toHaveTextContent("Bravo");
    expect(screen.getAllByTestId("dropdown-item")[1]).toHaveTextContent("Alpha");
  });

  test("persists the selected sort mode", () => {
    window.localStorage.setItem(
      "kilocode:model-selector-sort-mode",
      "price-high",
    );

    mockUsePreferredModels.mockReturnValue(["model-1", "model-2"]);
    mockUseProviderModels.mockReturnValue({
      provider: "openrouter",
      providerModels: {
        "model-1": {
          displayName: "Alpha",
          inputPrice: 1,
          outputPrice: 1,
        },
        "model-2": {
          displayName: "Zulu",
          inputPrice: 5,
          outputPrice: 5,
        },
      },
      providerDefaultModel: "model-1",
      isLoading: false,
      isError: false,
    });

    render(
      <ModelSelector
        currentApiConfigName="test-profile"
        apiConfiguration={{
          apiProvider: "openrouter",
          openRouterModelId: "model-1",
        }}
        fallbackText="Select a model"
      />,
    );

    fireEvent.click(screen.getByTestId("dropdown-trigger"));

    const sortButton = screen.getByTestId("model-sort-button");
    expect(sortButton).toHaveTextContent("$$");
    expect(screen.getAllByTestId("dropdown-item")[0]).toHaveTextContent("Alpha");
    expect(screen.getAllByTestId("dropdown-item")[1]).toHaveTextContent("Zulu");
  });
});
