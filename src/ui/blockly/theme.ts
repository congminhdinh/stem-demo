import * as Blockly from 'blockly';

// The block editor's theme (N6a S5): Blockly's Zelos theme (the renderer is Zelos too) with the colours of the
// chrome's tokens (app.css) and its font. Blockly draws on SVG and takes no CSS variables, so the few colours it
// needs are written here, with the token each one stands for. The blocks keep the colours of their definitions.

export const editorFontFamily = "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const stemTheme = Blockly.Theme.defineTheme('stem-studio', {
  name: 'stem-studio',
  base: Blockly.Themes.Zelos,
  fontStyle: { family: editorFontFamily, weight: '600', size: 12 },
  componentStyles: {
    workspaceBackgroundColour: '#f6f7fb', // --stem-color-bg
    toolboxBackgroundColour: '#ffffff', // --stem-color-surface
    toolboxForegroundColour: '#1e293b', // --stem-color-text
    flyoutBackgroundColour: '#f1f4f9', // --stem-color-surface-muted
    flyoutForegroundColour: '#1e293b', // --stem-color-text
    flyoutOpacity: 1,
    scrollbarColour: '#a3b1c6', // --stem-color-border-strong
    insertionMarkerColour: '#4f46e5', // --stem-color-primary
    selectedGlowColour: '#f97316', // --stem-color-accent
  },
});
