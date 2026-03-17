import React, { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DropdownPosition } from '../../hooks/completionTypes'

interface KiloDropdownProps {
    isVisible: boolean
    position: DropdownPosition
    width?: number
    children: React.ReactNode
    onClose: () => void
    selectedIndex?: number
    dataNav?: 'keyboard' | 'mouse'
    offsetY?: number
    offsetX?: number
    anchorEl?: HTMLElement | null
}

export const KiloDropdown: React.FC<KiloDropdownProps> = ({
    isVisible,
    position,
    width = 300,
    children,
    onClose,
    selectedIndex,
    dataNav = 'keyboard',
    offsetY = 4,
    offsetX = 0
}) => {
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                onClose()
            }
        }
        if (isVisible) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isVisible, onClose])

    if (!isVisible) return null

    // Ensure dropdown stays within viewport
    let left = position.left + offsetX
    let top = position.top + position.height + offsetY

    // Simple viewport bounds check
    if (left + width > window.innerWidth) {
        left = window.innerWidth - width - 10
    }
    if (top + 200 > window.innerHeight) {
        top = position.top - 200 - offsetY // Show above if not enough space
    }

    const style: React.CSSProperties = {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
        zIndex: 1000,
        background: 'var(--vscode-dropdown-background)',
        border: '1px solid var(--vscode-dropdown-border)',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        maxHeight: '300px',
        overflowY: 'auto',
        padding: '4px 0'
    }

    return createPortal(
        <div
            ref={dropdownRef}
            style={style}
            data-nav={dataNav}
            className="kilo-dropdown"
        >
            {children}
        </div>,
        document.body
    )
}

interface KiloDropdownItemProps {
    item: {
        id: string
        label?: string
        detail?: string
        icon?: string
        type: string
    }
    isSelected: boolean
    index: number
    onClick: () => void
    onMouseEnter: () => void
    children?: React.ReactNode
}

export const KiloDropdownItem: React.FC<KiloDropdownItemProps> = ({
    item,
    isSelected,
    index,
    onClick,
    onMouseEnter,
    children
}) => {
    const itemRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (isSelected && itemRef.current) {
            itemRef.current.scrollIntoView({ block: 'nearest' })
        }
    }, [isSelected])

    return (
        <div
            ref={itemRef}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: '12px',
                color: isSelected ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                background: isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                gap: '8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
            }}
        >
            {children ? children : (
                <>
                    {item.icon && <i className={`codicon codicon-${item.icon}`} style={{ fontSize: '14px', flexShrink: 0 }} />}
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div style={{ fontWeight: isSelected ? 'bold' : 'normal' }}>{item.label}</div>
                        {item.detail && (
                            <div style={{
                                fontSize: '10px',
                                opacity: 0.6,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                direction: 'rtl',
                                textAlign: 'left'
                            }}>
                                {item.detail}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
