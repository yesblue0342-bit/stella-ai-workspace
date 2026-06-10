export const STELLA_APP = {
  name: "Stella Workspace"
};

export const STELLA_MODELS = [
  { id: "chatgpt-5.3-latest", label: "chatgpt-5.3-latest" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "claude_sonnet-4.6", label: "claude_sonnet-4.6" },
  { id: "grok-4.3", label: "grok-4.3" },
  { id: "gemini-3-1-pro-preview-web", label: "gemini-3-1-pro-preview-web" }
];

export const STELLA_DEFAULT_TREE = [];

export const STELLA_FEATURES = {
  projectCreate: true,
  projectRename: true,
  projectCopy: true,
  projectMove: true,
  projectDelete: true,

  chatCreate: true,
  chatRename: true,
  chatCopy: true,
  chatMove: true,
  chatDelete: true
};

export const GOOGLE_DRIVE = {
  enabled: false,
  visibleInSidebar: false
};
