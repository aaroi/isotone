import './globals.css';

export const metadata = {
  title: 'Trail Finder',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
