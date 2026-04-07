import * as vscode from "vscode";

import { ClineProvider } from "../../webview/ClineProvider";
import { getUri } from "../../webview/getUri";
import { getNonce } from "../../webview/getNonce";
import { webviewMessageHandler } from "../../webview/webviewMessageHandler";
import { getResolvedFileIconTheme } from "../../webview/fileIconTheme";

export class NativeAgentManagerProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private panelProvider: ClineProvider | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly baseProvider: ClineProvider,
  ) {}

  public async openPanel() {
    if (this.panel) {
      try {
        if (this.panel.viewColumn !== undefined) {
          this.panel.reveal(vscode.ViewColumn.Beside);
          return;
        }
      } catch {
        // Fall through and recreate the panel if the old reference is stale.
      }

      this.panel = undefined;
      void this.panelProvider?.dispose();
      this.panelProvider = undefined;
      this.clearDisposables();
    }

    const panel = vscode.window.createWebviewPanel(
      "kade.nativeAgentManager",
      "Agent Manager",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    this.panel = panel;

    const fileIconTheme = await getResolvedFileIconTheme(panel.webview).catch(
      () => ({
        fontCss: "",
        theme: null,
        localResourceRoots: [],
      }),
    );

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, "webview-ui"),
        vscode.Uri.joinPath(this.context.extensionUri, "assets"),
        ...fileIconTheme.localResourceRoots,
      ],
    };

    panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "assets",
        "icons",
        "sidebar-icon.png",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "assets",
        "icons",
        "sidebar-icon.png",
      ),
    };

    const panelProvider = this.getOrCreatePanelProvider();
    panelProvider.registerMirroredWebview(panel.webview);
    panel.webview.html =
      this.context.extensionMode === vscode.ExtensionMode.Development
        ? await this.getHmrHtml(panel.webview)
        : await this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      async (message) => {
        await webviewMessageHandler(panelProvider as any, message);

        if (message?.type === "webviewDidLaunch") {
          await panel.webview.postMessage({
            type: "state",
            state: await panelProvider.getStateToPostToWebview(),
          });
          await panel.webview.postMessage({
            type: "action",
            action: "didBecomeVisible",
          });
        }
      },
      undefined,
      this.disposables,
    );

    panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.visible) {
          void panel.webview.postMessage({
            type: "action",
            action: "didBecomeVisible",
          });
        }
      },
      undefined,
      this.disposables,
    );

    panel.onDidDispose(
      () => {
        this.panelProvider?.unregisterMirroredWebview(panel.webview);

        if (this.panel === panel) {
          this.panel = undefined;
        }

        const panelProviderToDispose = this.panelProvider;
        this.panelProvider = undefined;
        void panelProviderToDispose?.dispose();
        this.clearDisposables();
      },
      undefined,
      this.disposables,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
  }

  public dispose() {
    if (this.panel) {
      this.panelProvider?.unregisterMirroredWebview(this.panel.webview);
    }

    this.clearDisposables();

    void this.panelProvider?.dispose();
    this.panelProvider = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private getOrCreatePanelProvider() {
    if (!this.panelProvider) {
      this.panelProvider = new ClineProvider(
        this.context,
        this.outputChannel,
        "editor",
        this.baseProvider.contextProxy,
      );
    }

    return this.panelProvider;
  }

  private clearDisposables() {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async getHmrHtml(webview: vscode.Webview) {
    const { getVitePort } = await import("../../webview/getViteDevServerConfig");
    const localPort = getVitePort();
    const localServerUrl = `127.0.0.1:${localPort}`;
    const nonce = getNonce();

    const stylesUri = getUri(webview, this.context.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.css",
    ]);
    const codiconsUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "codicons",
      "codicon.css",
    ]);
    const scriptUri = `http://${localServerUrl}/src/kilocode/native-agent-manager/index.tsx`;

    const fileIconTheme = await getResolvedFileIconTheme(webview).catch(() => ({
      fontCss: "",
      theme: null,
      localResourceRoots: [],
    }));
    const serializedFileIconTheme = JSON.stringify(
      fileIconTheme.theme ?? null,
    ).replace(/</g, "\\u003c");
    const imagesUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "images",
    ]);
    const providersUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "providers",
    ]);
    const audioUri = getUri(webview, this.context.extensionUri, [
      "webview-ui",
      "audio",
    ]);

    const reactRefresh = `
      <script nonce="${nonce}" type="module">
        import RefreshRuntime from "http://${localServerUrl}/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
      </script>
    `;

    const csp = [
      "default-src 'none'",
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl}`,
      `img-src ${webview.cspSource} data: https://*.googleusercontent.com https://storage.googleapis.com https://*.githubusercontent.com https://img.clerk.com https://*.googleapis.com https://registry.npmmirror.com https://*.lobehub.com https://*.google.com https://icons.duckduckgo.com`,
      `media-src ${webview.cspSource} blob:`,
      `script-src 'unsafe-eval' ${webview.cspSource} http://${localServerUrl} 'nonce-${nonce}'`,
      `connect-src ${webview.cspSource} ws://${localServerUrl} http://${localServerUrl} https://*`,
      "worker-src blob:",
    ];

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <meta http-equiv="Permissions-Policy" content="microphone=(self)">
          <meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <link href="${codiconsUri}" rel="stylesheet" />
          <script nonce="${nonce}">
            window.IMAGES_BASE_URI = "${imagesUri}";
            window.AUDIO_BASE_URI = "${audioUri}";
            window.PROVIDERS_BASE_URI = "${providersUri}";
            window.ACTIVE_FILE_ICON_THEME = ${serializedFileIconTheme};
            window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}";
          </script>
          ${fileIconTheme.fontCss ? `<style>${fileIconTheme.fontCss}</style>` : ""}
          <title>Agent Manager</title>
        </head>
        <body>
          <div id="root"></div>
          ${reactRefresh}
          <script type="module" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }

  private async getHtml(webview: vscode.Webview) {
    const stylesUri = getUri(webview, this.context.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "index.css",
    ]);
    const scriptUri = getUri(webview, this.context.extensionUri, [
      "webview-ui",
      "build",
      "assets",
      "agent-manager.js",
    ]);
    const codiconsUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "codicons",
      "codicon.css",
    ]);
    const imagesUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "images",
    ]);
    const providersUri = getUri(webview, this.context.extensionUri, [
      "assets",
      "providers",
    ]);
    const audioUri = getUri(webview, this.context.extensionUri, [
      "webview-ui",
      "audio",
    ]);
    const nonce = getNonce();
    const fileIconTheme = await getResolvedFileIconTheme(webview).catch(() => ({
      fontCss: "",
      theme: null,
      localResourceRoots: [],
    }));
    const serializedFileIconTheme = JSON.stringify(
      fileIconTheme.theme ?? null,
    ).replace(/</g, "\\u003c");

    const csp = [
      "default-src 'none'",
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: https://*.googleusercontent.com https://storage.googleapis.com https://*.githubusercontent.com https://img.clerk.com https://*.googleapis.com https://registry.npmmirror.com https://*.lobehub.com https://*.google.com https://icons.duckduckgo.com`,
      `media-src ${webview.cspSource} blob:`,
      `script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}'`,
      `connect-src ${webview.cspSource} https://*`,
      "worker-src blob:",
    ];

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <meta http-equiv="Permissions-Policy" content="microphone=(self)">
          <meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <link href="${codiconsUri}" rel="stylesheet" />
          <script nonce="${nonce}">
            window.IMAGES_BASE_URI = "${imagesUri}";
            window.AUDIO_BASE_URI = "${audioUri}";
            window.PROVIDERS_BASE_URI = "${providersUri}";
            window.ACTIVE_FILE_ICON_THEME = ${serializedFileIconTheme};
            window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}";
          </script>
          ${fileIconTheme.fontCss ? `<style>${fileIconTheme.fontCss}</style>` : ""}
          <title>Agent Manager</title>
        </head>
        <body>
          <div id="root"></div>
          <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
