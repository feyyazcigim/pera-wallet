'use client';

import React from 'react';
import { motion } from 'motion/react';

interface MagnetTabsProps {
    slug: string;
    options: string[];
    onSelect: (option: string) => void;
    activeTab: string;
}

export function MagnetTabs({ slug, options, onSelect, activeTab }: MagnetTabsProps) {
    const [hovered, setHovered] = React.useState<string | undefined>(undefined);

    return (
        <div className="flex items-start justify-start">
            <ul className="flex border-[1px] border-black/10 dark:border-white/10 border-b-0">
                {options.map((option) => {
                    const isActive = activeTab === option;
                    return (
                        <li
                            onMouseEnter={() => setHovered(option)}
                            onMouseLeave={() => setHovered(undefined)}
                            key={slug + option}
                            onClick={() => onSelect(option)}
                            className="relative cursor-pointer shrink-0"
                        >
                            <p
                                className={`z-10 relative px-3 py-2 transition-all text-sm ${isActive ? 'opacity-100' : 'opacity-50 hover:opacity-100'
                                    }`}
                            >
                                {option}
                            </p>

                            {isActive && (
                                <motion.div
                                    layout
                                    layoutId={slug + 'magnet'}
                                    transition={{ duration: 0.2, type: 'spring', bounce: 0.2 }}
                                    className="w-full h-1 absolute bottom-full left-0 bg-[#ffd400] rounded-sm"
                                />
                            )}

                            {(hovered === option || (hovered === undefined && isActive)) && (
                                <motion.div
                                    layout
                                    layoutId={slug + 'tab-bar-highlight'}
                                    transition={{ duration: 0.2, type: 'spring', bounce: 0 }}
                                    className="w-full h-full absolute bottom-0 left-0 bg-black/5 dark:bg-white/10 rounded-sm"
                                />
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default MagnetTabs;
