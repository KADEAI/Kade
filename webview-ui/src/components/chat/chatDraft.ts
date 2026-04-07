export const hasDraftContent = (
  inputValue: string,
  selectedImages: string[],
) => inputValue.trim().length > 0 || selectedImages.length > 0;
