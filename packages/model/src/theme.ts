import type { ThemeName } from './types';

export const themeColors: Record<
  ThemeName,
  {
    canvas: string;
    chrome: string;
    chromeInk: string;
    ink: string;
    accent: string;
    muted: string;
    panel: string;
    line: string;
    grid: string;
  }
> = {
  light: {
    canvas: '#f6f4ee',
    chrome: '#26292f',
    chromeInk: '#f4f1e8',
    ink: '#26292f',
    accent: '#0e7a6d',
    muted: '#837c6e',
    panel: '#fdfcf8',
    line: '#e4dfd2',
    grid: '#d6cfba',
  },
  dark: {
    canvas: '#1b1d20',
    chrome: '#e6e3da',
    chromeInk: '#26292f',
    ink: '#e6e3da',
    accent: '#4db6a7',
    muted: '#958f84',
    panel: '#25272c',
    line: '#3a3d42',
    grid: '#31343a',
  },
};

export const penDefault = '#1d4e89';
export const highlighterDefault = '#e6b800';

export const STORAGE_KEY = 'plume.board.v1';
