import { defineConfig } from 'turbowatch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  project: __dirname,
  triggers: [
    {
      expression: ['match', '**/*.ts', 'basename'],
      name: 'backend',
      onChange: async ({ spawn }) => {
        await spawn`tsx src/server.ts`;
      },
      persistent: false,
      interruptible: true,
    },
  ],
});