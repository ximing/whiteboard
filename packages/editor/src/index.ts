import './i18n';

export { PlumeEditor } from './PlumeEditor';
export type { EditorStorage, PlumeEditorProps } from './PlumeEditor';
export { useTranslation } from 'react-i18next';
export { setLanguage, type PlumeLanguage } from './i18n';
export { createDataUrlImageProvider, dataUrlImageProvider } from './images';
export type { ImageProvider } from './images';
export { frameCorners, hitHandle, selectionHandles } from './render';
