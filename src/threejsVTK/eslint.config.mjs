// Chỉ một luật, nhưng là luật bắt được lớp bug nguy hiểm nhất khi refactor:
// dùng một identifier không được khai báo cũng không được import (ReferenceError
// lúc chạy, không lộ ra lúc build).
export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly", document: "readonly", console: "readonly",
        performance: "readonly", requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly", ResizeObserver: "readonly",
        globalThis: "readonly", atob: "readonly", Buffer: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", DOMParser: "readonly",
        Image: "readonly", HTMLElement: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
];
