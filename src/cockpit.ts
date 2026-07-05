// The real cockpit object is provided by <script src="../base1/cockpit.js"> at runtime.
// This module re-exports it so app code can `import cockpit from 'cockpit'`.
// In unit tests this file is aliased and never touched — core code takes host access via injected interfaces.
import type Cockpit from 'cockpit'
const cockpit = (globalThis as unknown as { cockpit: typeof Cockpit }).cockpit
export default cockpit
