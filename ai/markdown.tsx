/**
 * The Markdown the assistant writes, rendered as GitHub does it:
 * react-markdown with remark-gfm (tables, task lists, strikethrough,
 * autolinks). Raw HTML in the source is never rendered, and react-markdown's
 * URL filter drops javascript: and the like.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components = {
  // Links leave the app rather than replacing it.
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export function Markdown({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <div className={className ? `ze-md ${className}` : 'ze-md'}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
