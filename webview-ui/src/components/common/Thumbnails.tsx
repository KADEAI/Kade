import React, { useState, useRef, useLayoutEffect, memo } from "react"
import { useWindowSize } from "react-use"
import { vscode } from "@src/utils/vscode"
import { ImagePreviewModal } from "./ImagePreviewModal"

interface ThumbnailsProps {
	images: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
	onOpenImage?: (image: string) => void // kilocode_change: allows custom image preview handling
}

const Thumbnails = ({ images, style, setImages, onHeightChange, onOpenImage }: ThumbnailsProps) => {
	// Use CSS group-hover for the delete button to ensure it's accessible even when hovering slightly outside the image
	const [selectedImage, setSelectedImage] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const { width } = useWindowSize()

	useLayoutEffect(() => {
		if (containerRef.current) {
			let height = containerRef.current.clientHeight
			// some browsers return 0 for clientHeight
			if (!height) {
				height = containerRef.current.getBoundingClientRect().height
			}
			onHeightChange?.(height)
		}
		
	}, [images, width, onHeightChange])

	const handleDelete = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const isDeletable = setImages !== undefined

	const handleImageClick = (image: string) => {
		if (onOpenImage) {
			onOpenImage(image)
		} else {
			setSelectedImage(image)
		}
	}

	return (
		<>
			<div
				ref={containerRef}
				className="py-1"
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 5,
					rowGap: 3,
					...style,
				}}>
				{images.map((image, index) => (
					<div key={index} className="relative group">
	{/* Hover hit area expansion: allows the 'X' button to be hovered from the outside */}
	<div className="absolute -top-1.5 -right-1.5 -bottom-0.5 -left-0.5" />
	<img
		src={image}
		alt={`Thumbnail ${index + 1}`}
		className="image-glowing-hover"
		style={{
			width: 34,
			height: 34,
			objectFit: "cover",
			borderRadius: 4,
			cursor: "pointer",
		}}
		onClick={() => handleImageClick(image)}
	/>
	{isDeletable && (
		<div
			onClick={(e) => {
				e.stopPropagation()
				handleDelete(index)
			}}
			className="absolute -top-1 -right-1 w-[13px] h-[13px] rounded-full flex items-center justify-center cursor-pointer z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-sm"
			style={{
				backgroundColor: "var(--vscode-badge-background)",
			}}>
			<span
				className="codicon codicon-close"
				style={{
					color: "var(--vscode-foreground)",
					fontSize: 10,
					fontWeight: "bold",
				}}></span>
		</div>
	)}
</div>
				))}
			</div>
			<ImagePreviewModal
				isOpen={!!selectedImage}
				onClose={() => setSelectedImage(null)}
				imageUri={selectedImage || ""}
			/>
		</>
	)
}

export default memo(Thumbnails)
