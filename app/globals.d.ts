declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
    "s-progress": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { value?: number },
      HTMLElement
    >;
    "s-empty-state": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { heading?: string },
      HTMLElement
    >;
  }
}
