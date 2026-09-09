"use client"; // PF has no server component support

import '@patternfly/react-core/dist/styles/base.css';
import '@patternfly/patternfly/patternfly-charts.css';
import "./globals.css";

import { Page } from '@patternfly/react-core';
import { css } from '@patternfly/react-styles';
import { useEffect, useState } from 'react';

const useTheme = (): string => {
    const [systemTheme, setSystemTheme] = useState<string | false>(false);
  const [contrast, setContrast] = useState<string | false>(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    const contrastQueryList = window.matchMedia('(prefers-contrast: more)');

    const updateSystemTheme = () => {
      if (contrastQueryList.matches) {
        setContrast('pf-v6-theme-contrast');
      } else {
        setContrast(false);
      }
      if (mediaQueryList.matches) {
        setSystemTheme('pf-v6-theme-dark');
      } else {
        setSystemTheme('pf-v6-theme-light');
      }
    };

    updateSystemTheme();

    mediaQueryList.addEventListener('change', updateSystemTheme);
    contrastQueryList.addEventListener('change', updateSystemTheme);

    return () => {
      mediaQueryList.removeEventListener('change', updateSystemTheme);
      contrastQueryList.removeEventListener('change', updateSystemTheme);
    };
  }, []);

  return css(systemTheme, contrast, 'pf-v6-theme-glass')
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const themeClass = useTheme();

  return (
    <html lang="en" className={themeClass}>
      <head>
        <title>Dashboard^2</title>
      </head>
      <body>
        <Page isContentFilled sidebar={null}>
          {children}
        </Page>
      </body>
    </html>
  );
}
