```markdown
# ble-e2e-tests Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `ble-e2e-tests` repository, a TypeScript-based codebase for end-to-end testing of BLE (Bluetooth Low Energy) systems. You'll learn about file naming, import/export styles, commit conventions, and how to write and organize tests, even in the absence of a formal framework.

## Coding Conventions

### File Naming
- Use **kebab-case** for all file names.
  - Example:  
    ```
    ble-device-manager.ts
    connection-handler.test.ts
    ```

### Import Style
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { connectDevice } from './device-connector';
    import { runTest } from '../utils/test-runner';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In device-connector.ts
    export function connectDevice() { ... }
    export function disconnectDevice() { ... }
    ```

### Commit Messages
- Follow **conventional commit** style, with prefixes such as `ci`.
  - Example:
    ```
    ci: add GitHub Actions workflow for test automation
    ```

## Workflows

_No automated workflows detected in this repository. Add CI/CD or other automation as needed to streamline development._

## Testing Patterns

- **Test File Naming:**  
  Test files follow the pattern `*.test.*` (e.g., `connection-handler.test.ts`).
- **Framework:**  
  No specific testing framework detected. Tests may be run using custom scripts or a generic runner.
- **Test Structure:**  
  Organize test logic in dedicated test files, using named exports for test functions.
  - Example:
    ```typescript
    // connection-handler.test.ts
    export function testConnectionSuccess() { ... }
    export function testConnectionFailure() { ... }
    ```

## Commands

| Command    | Purpose                                      |
|------------|----------------------------------------------|
| /test      | Run all test files matching `*.test.*`       |
| /lint      | Lint the codebase for style and errors       |
| /commit    | Create a conventional commit                 |

> _Note: Commands are suggested for workflow automation. Implement them as scripts or aliases as needed._
```