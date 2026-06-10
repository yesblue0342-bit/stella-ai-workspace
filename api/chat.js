function normalizeOpenAIModel(model) {

  const value =
    String(model || "")
      .toLowerCase();

  if (value.includes("gpt-5.5")) {
    return "gpt-4o";
  }

  if (value.includes("gpt-5")) {
    return "gpt-4o";
  }

  if (value.includes("gpt-4.1-mini")) {
    return "gpt-4.1-mini";
  }

  if (value.includes("gpt-4.1")) {
    return "gpt-4.1";
  }

  if (value.includes("gpt-4o-mini")) {
    return "gpt-4o-mini";
  }

  return "gpt-4o";
}
