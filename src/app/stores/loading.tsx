import { TextPageSkeleton } from "@/components/skeletons";

/** Shown the moment a link here is tapped, while the page loads (F4). */
export default function Loading() {
  return <TextPageSkeleton label="Loading stores" />;
}
