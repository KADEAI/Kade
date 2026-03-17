import React, { useMemo } from 'react';
import { getIconForFilePath, getIconUrlByName, getIconForDirectoryPath } from "vscode-material-icons"
import { SiRust } from 'react-icons/si';
import styled from 'styled-components';

interface FileIconProps {
    fileName: string;
    size?: number;
    className?: string;
    isDirectory?: boolean;
}

const IconImage = styled.img`
    display: block;
    flex-shrink: 0;
`;

const IconWrapper = styled.span<{ $color?: string }>`
    display: inline-block;
    vertical-align: text-bottom;
    line-height: 0;
    flex-shrink: 0;
    ${props => props.$color && `color: ${props.$color} !important;`}
`;

export const FileIcon: React.FC<FileIconProps> = ({ fileName, size = 16, className, isDirectory }) => {
    const isRust = useMemo(() => {
        const name = (fileName || "").replace("file://", "").toLowerCase();
        return !isDirectory && (name.endsWith('.rs') || name === 'rust');
    }, [fileName, isDirectory]);

    const isCargoLock = useMemo(() => {
        const name = (fileName || "").toLowerCase();
        return !isDirectory && name.endsWith('cargo.lock');
    }, [fileName, isDirectory]);

    const iconUrl = useMemo(() => {
        if (isRust) return null;
        const w = window as any;
        const baseUri = w.MATERIAL_ICONS_BASE_URI || "";

        // Clean the filename and extract basename
        let cleanName = (fileName || "").replace("file://", "").trim();
        
        // Remove @ prefix if present
        if (cleanName.startsWith("@")) {
            cleanName = cleanName.slice(1);
        }
        
        // Remove line numbers (e.g., :42 or :42-45)
        cleanName = cleanName.split(":")[0];
        
        // Extract basename (last part of path)
        const parts = cleanName.split(/[\\/]/).filter(Boolean);
        const name = parts[parts.length - 1] || "";
        
        // If still empty, return null to show a default icon
        if (!name) return null;

        const iconName = isDirectory
            ? getIconForDirectoryPath(name)
            : getIconForFilePath(name);

        return getIconUrlByName(iconName, baseUri);
    }, [fileName, isDirectory, isRust]);

    if (isRust) {
        return (
            <IconWrapper $color="#DEA584" className={className}>
                <SiRust size={size} />
            </IconWrapper>
        );
    }

    if (!iconUrl) return null;

    return (
        <IconWrapper $color={isCargoLock ? "#4daafc" : undefined} className={className}>
            <IconImage
                src={iconUrl}
                width={size}
                height={size}
                className={className}
                alt=""
                onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                }}
            />
        </IconWrapper>
    );
};
