import { McpResource, McpResourceTemplate } from "@roo/mcp";
import { cn } from "@/lib/utils";

type McpResourceRowProps = {
  item: McpResource | McpResourceTemplate;
};

const McpResourceRow = ({ item }: McpResourceRowProps) => {
  const hasUri = "uri" in item;
  const uri = hasUri ? item.uri : item.uriTemplate;

  return (
    <div
      key={uri}
      className="py-2.5 border-b border-vscode-panel-border last:border-b-0 space-y-1.5 overflow-hidden"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="codicon codicon-symbol-file shrink-0 text-vscode-symbolIcon-fileForeground" />
        <span className="text-[11px] font-bold text-vscode-foreground truncate tracking-tight bg-vscode-badge-background/5 px-1.5 py-0.5 rounded border border-vscode-badge-background/10">
          {uri}
        </span>
      </div>
      {item.description || item.name ? (
        <div className="text-[11px] text-vscode-descriptionForeground leading-relaxed px-1">
          {item.name && (
            <span className="font-bold text-vscode-foreground mr-1.5 opacity-90">
              {item.name}
            </span>
          )}
          <span className="opacity-80">
            {item.description || "No description"}
          </span>
        </div>
      ) : (
        <div className="text-[11px] text-vscode-descriptionForeground/40 italic px-1">
          No description
        </div>
      )}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-30">
          Returns
        </span>
        <code className="text-[10px] text-vscode-textPreformat-foreground bg-vscode-textPreformat-background/50 px-1.5 py-0.5 rounded font-mono font-bold tracking-tight">
          {item.mimeType || "Unknown"}
        </code>
      </div>
    </div>
  );
};

export default McpResourceRow;
