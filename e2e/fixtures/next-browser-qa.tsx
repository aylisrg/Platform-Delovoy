import type { AnchorHTMLAttributes } from "react";

// Only the routing adapters are replaced; the checkout and result UI are real.
export function useParams() {
  return { id: location.pathname.split("/").pop() };
}

export function useRouter() {
  return { refresh() {} };
}

export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
