export const STELLA_APP = {
  name: "Stella Workspace",
  subtitle: "AI 작업공간"
};

export const STELLA_MODELS = [
  { id: "chatgpt-5.5-latest", label: "ChatGPT 5.5 Latest", provider: "openai", enabled: true },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", enabled: true },
  { id: "gpt-5", label: "GPT-5", provider: "openai", enabled: true },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", enabled: true },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", enabled: true },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", enabled: true },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", enabled: true },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "claude", enabled: true },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "claude", enabled: true },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "claude", enabled: true }
];

export const STELLA_DEFAULT_MODEL = "chatgpt-5.5-latest";
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
  chatDelete: true,
  webSearch: true,
  fileUpload: true,
  imageUpload: true,
  voiceInput: false,
  textExport: true,
  stellaDb: true,
  googleDrive: true,
  developerMode: true,
  diagnostics: true
};

export const GOOGLE_DRIVE = {
  enabled: true,
  showInSidebar: true,
  rootLabel: "Stella DB",
  dbUrl: "/db",
  diagnosticsUrl: "/api/drive-diagnostics"
};

export const DEVELOPER_MODE = {
  enabled: true,
  url: "/developer",
  checks: [
    { label: "DB 연결", url: "/api/db-test" },
    { label: "Drive 진단", url: "/api/drive-diagnostics" },
    { label: "Drive 목록", url: "/api/stella?action=db-directory" }
  ]
};

export const WEB_SEARCH = {
  enabled: true,
  provider: "serper",
  endpoint: "/api/search"
};

export const STELLA_UI = {
  showProviderName: true,
  showModelSelector: true,
  showSearchButton: true,
  showUploadButton: true,
  showExportButton: true,
  showStellaDbButton: true,
  showDeveloperButton: true
};

export default {
  STELLA_APP,
  STELLA_MODELS,
  STELLA_DEFAULT_MODEL,
  STELLA_DEFAULT_TREE,
  STELLA_FEATURES,
  GOOGLE_DRIVE,
  DEVELOPER_MODE,
  WEB_SEARCH,
  STELLA_UI
};
