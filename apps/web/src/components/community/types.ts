export interface ModelCardData {
  id: string;
  image_url: string | null;
  title: string;
  category: string | null;
  tags: string[];
  creator: { handle: string; name: string | null };
  license_code: string;
  photo_file_id: string | null;
  thumbnail_file_id: string | null;
  printable: boolean;
  needs_repair: boolean;
  file_types: string[];
  downloads: number;
  likes: number;
  saves: number;
  published_at: string | null;
}

export interface PublicFile {
  id: string;
  role: string;
  filename: string;
  content_type: string;
  bytes: number;
}

export interface Lineage {
  id: string;
  title: string;
  creator: string;
  license_code: string;
}

export interface ModelDetail extends Omit<ModelCardData, 'creator'> {
  description: string;
  print_notes: Record<string, string | number> | null;
  publish_status: 'NONE' | 'REVIEW' | 'PUBLISHED' | 'REJECTED' | 'REMOVED';
  listed: boolean;
  review_note: string | null;
  license: { code: string; name: string; attribution: string; allows_print_order: boolean; allows_derivatives: boolean; allows_commercial: boolean };
  creator: { handle: string; name: string | null; followers: number; models: number };
  files: PublicFile[];
  photos: (PublicFile & { url: string })[];
  view: { url: string; format: 'glb' | 'stl' } | null;
  bbox_mm: number[] | null;
  triangles: number | null;
  remix_of: Lineage | null;
  remixes: Lineage[];
  is_owner: boolean;
  liked: boolean;
  saved: boolean;
  following: boolean;
}

export interface Comment {
  id: string;
  body: string;
  author: { handle: string | null; name: string | null };
  is_mine: boolean;
  created_at: string;
}

export interface CollectionData {
  id: string;
  title: string;
  description: string;
  is_public: boolean;
  items: number;
  owner: { handle: string | null; name: string | null };
  is_owner: boolean;
  created_at: string;
}

export const CATEGORIES: Record<string, string> = {
  household: 'Home and kitchen',
  organizers: 'Storage and organizers',
  tools: 'Tools and workshop',
  'mechanical-parts': 'Mechanical parts',
  electronics: 'Electronics and cases',
  gadgets: 'Gadgets and phone',
  toys: 'Toys and games',
  miniatures: 'Miniatures and figures',
  art: 'Art and decor',
  fashion: 'Wearables',
  education: 'Learning',
  printer: 'Printer upgrades',
  other: 'Everything else',
};
