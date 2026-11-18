import React from 'react';
import {
  Film,
  Music,
  Image as ImageIcon,
  FileArchive,
  FileText,
  Package,
  File,
} from 'lucide-react';
import { MediaCategory } from '../types/models';

interface CategoryIconProps {
  category: MediaCategory;
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ category, className = 'w-5 h-5' }) => {
  switch (category) {
    case 'video':
      return <Film className={className} />;
    case 'audio':
      return <Music className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'archive':
      return <FileArchive className={className} />;
    case 'document':
      return <FileText className={className} />;
    case 'software':
      return <Package className={className} />;
    default:
      return <File className={className} />;
  }
};

export function getCategoryStyles(category: MediaCategory): string {
  switch (category) {
    case 'video':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-400/25';
    case 'audio':
      return 'bg-teal-500/15 text-teal-600 dark:text-teal-300 border-teal-400/25';
    case 'image':
      return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-400/25';
    case 'archive':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-400/25';
    case 'document':
      return 'bg-green-500/15 text-green-600 dark:text-green-300 border-green-400/25';
    case 'software':
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-400/25';
    default:
      return 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-400/20';
  }
}
