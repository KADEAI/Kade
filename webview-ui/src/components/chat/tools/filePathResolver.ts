function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

export function resolveToolFilePath(tool: any, toolResult?: any): string {
  const nativeArgs = tool?.nativeArgs;
  const params = tool?.params;
  const toolFiles = Array.isArray(tool?.files) ? tool.files : [];
  const resultFiles = Array.isArray(toolResult?.files) ? toolResult.files : [];

  return firstString(
    tool?.path,
    tool?.file_path,
    tool?.target_file,
    params?.path,
    params?.file_path,
    params?.target_file,
    nativeArgs?.path,
    nativeArgs?.file_path,
    nativeArgs?.target_file,
    toolFiles[0]?.path,
    toolFiles[0]?.file_path,
    toolFiles[0]?.target_file,
    toolResult?.path,
    toolResult?.file_path,
    toolResult?.target_file,
    resultFiles[0]?.path,
    resultFiles[0]?.file_path,
    resultFiles[0]?.target_file,
  );
}
