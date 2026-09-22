import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableIframePageLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
});
