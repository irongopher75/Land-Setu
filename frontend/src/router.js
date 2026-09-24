import { useEffect, useState } from 'react';

// Hash routes keep every page linkable and work with the single-page rewrite on the host.
const read = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : `/${path}`, params: Object.fromEntries(new URLSearchParams(query)) };
};

export const navigate = (path) => {
  if (window.location.hash.replace(/^#/, '') !== path) window.location.hash = path;
};

export function useRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
