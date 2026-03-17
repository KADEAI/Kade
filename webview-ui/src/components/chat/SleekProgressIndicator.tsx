import React from "react"
import styled, { keyframes } from "styled-components"

const gradientMove = keyframes`
	0% { background-position: 0% 50%; }
	50% { background-position: 100% 50%; }
	100% { background-position: 0% 50%; }
`

const Container = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`

const BarContainer = styled.div`
	width: 120px;
	height: 6px;
	background: var(--vscode-notebook-cellEditorBackground, rgba(255, 255, 255, 0.05));
	border-radius: 3px;
	overflow: hidden;
	position: relative;
	box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
`

const Bar = styled.div`
	position: absolute;
	top: 0;
	left: 0;
	height: 100%;
	width: 100%;
	background: linear-gradient(
		90deg,
		var(--vscode-textLink-foreground),
		var(--vscode-button-background),
		var(--vscode-textLink-foreground)
	);
	background-size: 200% 100%;
	animation: ${gradientMove} 2s ease infinite;
	
	/* Mask to create the "loading bar" effect */
	mask-image: linear-gradient(
		90deg,
		transparent,
		#000 20%,
		#000 80%,
		transparent
	);
	-webkit-mask-image: linear-gradient(
		90deg,
		transparent,
		#000 20%,
		#000 80%,
		transparent
	);
`

const PulseBar = styled.div`
	position: absolute;
	top: 0;
	left: -100%;
	width: 100%;
	height: 100%;
	background: linear-gradient(
		90deg,
		transparent,
		rgba(255, 255, 255, 0.5),
		transparent
	);
	animation: slide 1.5s cubic-bezier(0.4, 0.0, 0.2, 1) infinite;

	@keyframes slide {
		0% { left: -100%; }
		100% { left: 100%; }
	}
`

export const SleekProgressIndicator = () => {
    return (
        <BarContainer>
            <Bar />
            <PulseBar />
        </BarContainer>
    )
}
