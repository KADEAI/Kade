import React, { useState, useEffect, useMemo, useRef } from 'react';
import './EmptyState.css';
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory";
import { vscode } from "@/utils/vscode";
import { useExtensionState } from "../../../context/ExtensionStateContext";
import { KilocodeNotifications } from "../../kilocode/KilocodeNotifications"; // kade_change
import { brandLogoDataUri } from "../../../assets/brand-logo";
import { Sparkles } from "lucide-react";

function formatRelativeShortTime(input?: number | string | Date): string {
    if (input === undefined || input === null) return '';
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);

    if (diff < 6) return 'spinner';
    if (diff < 60) return 'Now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

const PROMPT_SUGGESTIONS = [
    "What is the identity of this folder?",
    "Do a web search on french news",
    "Code me a snake game in Python",
    "How do I optimize a React useEffect hook?",
    "Explain the difference between let and const in JS",
    "Write a bash script to backup my home directory",
    "Create a responsive landing page with Tailwind CSS",
    "Implement a binary search algorithm in TypeScript",
    "How do I set up a Docker container for a Node.js app?",
    "Refactor this function to be more readable",
    "Write a unit test for a login component",
    "Build a simple CLI tool to track daily tasks",
    "How do I use CSS Grid for a 3-column layout?",
    "Create a neural network with TensorFlow.js",
    "Optimize this SQL query for better performance",
    "What are the best practices for REST API design?",
    "Help me debug this memory leak in my Go application",
    "Write a documentation README for a new library",
    "How do I implement OAuth2 in a Fastify app?",
    "Create a beautiful glassmorphism effect in CSS",
    "Build a real-time chat app with Socket.io",
    "How to handle large datasets in a frontend app?",
    "Write a Python script to scrape a news website",
    "Implement a custom hook for local storage in React",
    "How do I secure my Express.js server?",
    "Explain the SOLID principles with code examples",
    "Create a simple blockchain implementation in JS",
    "How to use Git submodules effectively?",
    "Build a weather app using a public API",
    "How do I configure Webpack for a production build?",
    "Write a cron job to clean up temporary files",
    "Implement a dark mode toggle in a web app",
    "How to use async/await with error handling?",
    "Create a 3D scene with Three.js",
    "Build a markdown previewer with React",
    "How do I use the Fetch API with TypeScript?",
    "Write a script to automate my git commits",
    "Explain how the Event Loop works in Node.js",
    "Create a CSS-only hamburger menu",
    "How to optimize images for the web?",
    "Build a personal finance tracker in Python",
    "How to use Redux Toolkit for state management?",
    "Write a script to convert JSON to CSV",
    "Implement a virtual scrolling list in React",
    "How to use SVGs effectively in web design?",
    "Build a simple URL shortener in Node.js",
    "How do I set up a CI/CD pipeline with GitHub Actions?",
    "Write a regular expression to validate an email",
    "Explain the concept of 'Higher Order Components'",
    "Create a custom VS Code theme",
    "How to use the ResizeObserver API?",
    "Build a pomodoro timer in JavaScript",
    "How do I implement lazy loading in React?",
    "Write a script to rename files in bulk",
    "Explain the 'this' keyword in JavaScript",
    "Create a simple physics simulation in Canvas",
    "How to use CSS variables for a theme system?",
    "Build a password generator with custom rules",
    "How do I handle file uploads in a backend?",
    "Write a function to deep clone an object",
    "Explain the difference between SQL and NoSQL",
    "Create a smooth scroll-to-top button",
    "How to use the Intersection Observer API?",
    "Build a simple calculator with React hooks",
    "How do I implement pagination in an API?",
    "Write a script to check for broken links on a site",
    "Explain the concept of 'Currying' in JS",
    "Create a beautiful loading spinner with CSS",
    "How to use the Clipboard API?",
    "Build a simple blog with a static site generator",
    "How do I set up a Redis cache for my app?",
    "Write a function to format currency",
    "Explain the concept of 'Closures' in JavaScript",
    "Create a custom range slider in CSS",
    "How to use the Geolocation API?",
    "Build a simple Todo list with local storage",
    "How do I implement a search filter in React?",
    "Write a script to compress images",
    "Explain the 'Box Model' in CSS",
    "Create a simple image gallery with lightboxes",
    "How to use the Web Audio API?",
    "Build a simple quiz app in JavaScript",
    "How do I implement a protected route in React?",
    "Write a function to flatten a nested array",
    "Explain the 'Flexbox' layout system",
    "Create a custom tooltip with pure CSS",
    "How to use the Notification API?",
    "Build a simple notes app with a backend",
    "How do I implement a debounced search?",
    "Write a script to download files from a URL",
    "Explain the 'Virtual DOM' in React",
    "Create a simple multi-step form",
    "How to use the Backdrop-filter CSS property?",
    "Build a simple music player in JavaScript",
    "How do I implement an infinite scroll?",
    "Write a function to generate a random hex color",
    "Explain the 'Prototypal Inheritance' in JS",
    "Create a custom checkboxes and radio buttons",
    "How to use the LocalStorage API effectively?",
    "Build a simple markdown editor",
    "How do I implement a drag and drop interface?"
];

interface EmptyStateProps {
    onSelectPrompt: (text: string) => void;
}

const PROMPT_ROTATION_MS = 6000;

export const EmptyState = ({ onSelectPrompt }: EmptyStateProps) => {
    const { taskHistoryVersion, cwd, showSubAgentBanner } = useExtensionState();
    const [promptIndex, setPromptIndex] = useState(0);
    const [isHovering, setIsHovering] = useState(false);
    const [isInitial, setIsInitial] = useState(true);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const folderName = useMemo(() => {
        if (!cwd) return "";
        // Handle both Windows and POSIX paths
        const parts = cwd.split(/[\\/]/);
        return parts.pop() || parts.pop() || "";
    }, [cwd]);

    const allSuggestions = useMemo(() => {
        const baseSuggestions = !folderName ? PROMPT_SUGGESTIONS : [
            `What does the ${folderName} project do?`,
            `Help me build a new feature for ${folderName}`,
            `Write a README for the ${folderName} folder`,
            `Explain the architecture of ${folderName}`,
            `How do I run tests in ${folderName}?`,
            `Identify technical debt in ${folderName}`,
            `Optimize the performance of ${folderName}`,
            `Refactor a component in ${folderName}`,
            `Fix a bug in the ${folderName} project`,
            `Add a new tool to ${folderName}`,
            `Integrate an API into ${folderName}`,
            `Improve the styling in ${folderName}`,
            `Add dark mode support to ${folderName}`,
            `Write unit tests for ${folderName}`,
            `Check for security vulnerabilities in ${folderName}`,
            `Clean up unused code in ${folderName}`,
            `Document the public API of ${folderName}`,
            `Help me understand the build process of ${folderName}`,
            `Migrate ${folderName} to the latest dependencies`,
            `Optimize the bundle size of ${folderName}`,
            `Add error logging to ${folderName}`,
            `Improve the accessibility of ${folderName}`,
            `Implement a new design system in ${folderName}`,
            `Set up CI/CD for the ${folderName} repo`,
            `How do I contribute to ${folderName}?`,
            `Map out the dependencies of ${folderName}`,
            `Create a setup guide for ${folderName}`,
            `Audit the performance of ${folderName}`,
            `Fix types in ${folderName}`,
            `Explain the folder structure of ${folderName}`,
            `Add telemetry to ${folderName}`,
            `Setup linting and formatting for ${folderName}`,
            `Implement a cache layer in ${folderName}`,
            `Add multi-language support to ${folderName}`,
            `Create a demo for ${folderName}`,
            `Write a blog post about ${folderName}`,
            `Find the entry point of ${folderName}`,
            `How does state management work in ${folderName}?`,
            `Add a search feature to ${folderName}`,
            `Implement pagination in ${folderName}`,
            `Set up a staging environment for ${folderName}`,
            `Dockerize the ${folderName} project`,
            `Add a contributing guide to ${folderName}`,
            `Review the code in ${folderName}`,
            `Suggest 5 improvements for ${folderName}`,
            `Help me onboard to ${folderName}`,
            `Write a changelog for ${folderName}`,
            `Add a license file to ${folderName}`,
            `Setup automated backups for ${folderName}`,
            `How do I debug ${folderName}?`,
            `Improve the loading speed of ${folderName}`,
            `Add a feedback form to ${folderName}`,
            `Implement a dashboard in ${folderName}`,
            `Connect ${folderName} to a database`,
            `Add unit tests to the ${folderName} core`,
            `Refactor the utils in ${folderName}`,
            `Create a CLI for ${folderName}`,
            `Sync ${folderName} with remote storage`,
            `Optimize the startup time of ${folderName}`,
            `Add a developer environment to ${folderName}`,
            `Help me deploy ${folderName} to production`,
            `Fix the mobile layout in ${folderName}`,
            `Add a tutorial to ${folderName}`,
            `Benchmark the core functions of ${folderName}`,
            `Setup a pre-commit hook in ${folderName}`,
            `Translate ${folderName} to Spanish`,
            `Add a health check to ${folderName}`,
            `Improve the SEO of ${folderName}`,
            `Integrate Sentry into ${folderName}`,
            `Add a 'Contact Us' page to ${folderName}`,
            `Enable hot reloading in ${folderName}`,
            `Write a technical spec for ${folderName}`,
            `Add a settings panel to ${folderName}`,
            `Optimize the SQL queries in ${folderName}`,
            `Help me rename components in ${folderName}`,
            `Create a custom hook for ${folderName}`,
            `Add an analytics dashboard to ${folderName}`,
            `Improve the UI consistency of ${folderName}`,
            `Setup a monorepo for ${folderName}`,
            `Add a 'What's New' section to ${folderName}`,
            `Optimize the images in ${folderName}`,
            `Add a PDF export feature to ${folderName}`,
            `Help me refactor the main loop of ${folderName}`,
            `Add a notification system to ${folderName}`,
            `Fix the z-index issues in ${folderName}`,
            `Set up a playground for ${folderName}`,
            `Add a 'Help' documentation to ${folderName}`,
            `Improve the developer docs for ${folderName}`,
            `Integrate Auth0 into ${folderName}`,
            `Add a 'Report a Bug' feature to ${folderName}`,
            `Optimize the memory usage of ${folderName}`,
            `Add a 'Share' button to ${folderName}`,
            `Setup a mock API for ${folderName}`,
            `Improve the form validation in ${folderName}`,
            `Add a 'Pro' version toggle to ${folderName}`,
            `Refactor the event handling in ${folderName}`,
            `How do I run ${folderName} in production mode?`,
            `Add a 'Search' bar to ${folderName}`,
            `Help me optimize the overall flow of ${folderName}`,
            `Implement a better layout for ${folderName}`,
            `Add user authentication to ${folderName}`,
            `Create a landing page for ${folderName}`,
            `Help me with the logic in ${folderName}`,
            `Make ${folderName} faster`,
            `Clean up the styles in ${folderName}`,
            `Add more tests to ${folderName}`,
            `Help me fix the layout of ${folderName}`,
            `Add a sidebar to ${folderName}`,
            `Implement a modal system in ${folderName}`,
            `Add a dark theme to ${folderName}`,
            `Make ${folderName} mobile friendly`,
            `Help me organize the files in ${folderName}`,
            `Add a settings page to ${folderName}`,
            `Implement a search bar in ${folderName}`,
            `Add a loading spinner to ${folderName}`,
            `Help me with the routing in ${folderName}`,
            `Add a footer to ${folderName}`,
            `Implement a theme switcher in ${folderName}`,
            `Add a notification center to ${folderName}`,
            `Help me refactor the state in ${folderName}`,
            `Add a dashboard to ${folderName}`,
            `Implement a chart in ${folderName}`,
            `Add a form to ${folderName}`,
            `Help me with the API calls in ${folderName}`,
            `Add a table to ${folderName}`,
            `Implement a filter in ${folderName}`,
            `Add a sorting feature to ${folderName}`,
            `Help me with the icons in ${folderName}`,
            `Add a tooltip to ${folderName}`,
            `Implement a dropdown in ${folderName}`,
            `Add a tab system to ${folderName}`,
            `Help me with the fonts in ${folderName}`,
            `Add a breadcrumb to ${folderName}`,
            `Implement a pagination in ${folderName}`,
            `Add a progress bar to ${folderName}`,
            `Help me with the colors in ${folderName}`,
            `Add a badge to ${folderName}`,
            `Implement a card system in ${folderName}`,
            `Add a carousel to ${folderName}`,
            `Help me with the spacing in ${folderName}`,
            `Add a border to ${folderName}`,
            `Implement a shadow system in ${folderName}`,
            `Add a transition to ${folderName}`,
            `Help me with the animations in ${folderName}`,
            `Add a transform to ${folderName}`,
            `Implement a grid system in ${folderName}`,
            `Add a flexbox system to ${folderName}`,
            `Help me with the responsive design in ${folderName}`,
            `Add a media query to ${folderName}`,
            `Implement a container system in ${folderName}`,
            `Add a wrapper to ${folderName}`,
            `Help me with the typography in ${folderName}`,
            `Add a heading to ${folderName}`,
            `Implement a paragraph system in ${folderName}`,
            `Add a link to ${folderName}`,
            `Help me with the buttons in ${folderName}`,
            `Add an input to ${folderName}`,
            `Implement a label system in ${folderName}`,
            `Add a textarea to ${folderName}`,
            `Help me with the forms in ${folderName}`,
            `Add a checkbox to ${folderName}`,
            `Implement a radio button system in ${folderName}`,
            `Add a select to ${folderName}`,
            `Help me with the dropdowns in ${folderName}`,
            `Add a file upload to ${folderName}`,
            `Implement a date picker in ${folderName}`,
            `Add a time picker to ${folderName}`,
            `Help me with the pickers in ${folderName}`,
            `Add a slider to ${folderName}`,
            `Implement a switch system in ${folderName}`,
            `Add a guest mode to ${folderName}`,
            `Help me with the user roles in ${folderName}`,
            `Add an admin panel to ${folderName}`,
            `Implement a user profile in ${folderName}`,
            `Add a help center to ${folderName}`,
            `Help me with the feedback system in ${folderName}`,
            `Add a bug reporting system to ${folderName}`,
            `Implement a feature request system in ${folderName}`,
            `Add a changelog to ${folderName}`,
            `Help me with the documentation in ${folderName}`,
            `Add a README to ${folderName}`,
            `Implement a LICENSE file in ${folderName}`,
            `Add a CONTRIBUTING file to ${folderName}`,
            `Help me with the git flow in ${folderName}`,
            `Add a .gitignore to ${folderName}`,
            `Implement a .env file in ${folderName}`,
            `Add a package.json to ${folderName}`,
            `Help me with the dependencies in ${folderName}`,
            `Add a script to ${folderName}`
        ];

        // Dynamic Shuffling: Modern Fisher-Yates shuffle
        const shuffled = [...baseSuggestions];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }, [folderName]);

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number>(Date.now());
    const remainingTimeRef = useRef<number>(PROMPT_ROTATION_MS);

    const startTimer = (duration: number) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        startTimeRef.current = Date.now();
        remainingTimeRef.current = duration;

        timerRef.current = setTimeout(() => {
            setIsInitial(false);
            setPromptIndex((prev) => (prev + 1) % allSuggestions.length);
            startTimer(PROMPT_ROTATION_MS);
        }, duration);
    };

    useEffect(() => {
        startTimer(PROMPT_ROTATION_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [allSuggestions.length]);

    useEffect(() => {
        if (isHovering) {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                const elapsed = Date.now() - startTimeRef.current;
                remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
            }
        } else {
            // Restore from where we left off
            startTimer(remainingTimeRef.current);
        }
    }, [isHovering]);

    const { data, isLoading } = useTaskHistory({
    	workspace: "current",
    	sort: "newest",
    	favoritesOnly: false,
    	pageIndex: 0,
    	pageSize: 5, // Only fetch 5 most recent for empty state
    }, taskHistoryVersion);

    const recentSessions = (data?.historyItems ?? [])
        .slice(0, 3)
        .map(item => ({
    id: item.id,
    title: item.task || (item as any).title,
    timeAgo: formatRelativeShortTime(item.ts)
}));

    const handleSessionClick = (id: string) => {
        vscode.postMessage({ type: "showTaskWithId", text: id });
    };

    return (
        <div className="emptyState in-chat">
            <div className="stars-container" aria-hidden="true">
                {useMemo(() => {
                    const colors = ['#ffffff', '#fff4e6', '#e6f2ff', '#f0e6ff']; // More premium, subtle palette
                    return [...Array(80)].map((_, i) => {
                        const size = Math.random() * 1.5 + 0.5;
                        const depth = Math.random();
                        return (
                            <div 
                                key={i} 
                                className="star" 
                                style={{
                                    top: `${Math.random() * 100}%`,
                                    left: `${Math.random() * 100}%`,
                                    width: `${size}px`,
                                    height: `${size}px`,
                                    backgroundColor: colors[Math.floor(Math.random() * colors.length)],
                                    filter: `blur(${depth > 0.7 ? '0.5px' : '0px'})`,
                                    ['--star-delay' as any]: `${Math.random() * -20}s`, // Negative delay starts them mid-cycle
                                    ['--star-duration' as any]: `${15 + Math.random() * 20}s`, // Much longer, slower cycles
                                    ['--star-opacity' as any]: 0.15 + Math.random() * 0.4,
                                }}
                            />
                        );
                    });
                }, [])}
            </div>
            <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none flex flex-col items-center pt-10 px-4">
                <div className="w-full max-w-[500px] flex flex-col gap-2">
                    {showSubAgentBanner !== false && (
                        <div className="sub-agent-ad-banner pointer-events-auto welcome-style">
                            <div className="sub-agent-ad-content">
                                <div className="sub-agent-ad-icon">
                                    <Sparkles size={10} />
                                </div>
                                <div className="sub-agent-ad-text">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="sub-agent-ad-title">🚀 Welcome to Kade!</span>
                                    </div>
                                    <span className="sub-agent-ad-description">
                                        To get started, select an AI provider in <span className="settings-link" onClick={() => vscode.postMessage({ type: "openExtensionSettings" })}>Settings</span>.  
                                    </span>
                                    <div className="sub-agent-promo-divider">
                                        <span className="sub-agent-ad-description">
                                            <strong className="text-white/90">Introducing Sub-Agents:</strong> Delegate complex tasks to specialized AI agents. You can disable this banner in Display Settings.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="pointer-events-auto">
                        <KilocodeNotifications />
                    </div>
                </div>
            </div>

            <div className="empty-branding">
                <img src={brandLogoDataUri} alt="Kade Logo" className="brand-logo-icon" />
                <div
                    className={`prompt-suggestion-container ${isHovering ? 'hovered' : ''}`}
                    onClick={() => {
                        onSelectPrompt(allSuggestions[promptIndex]);
                        // Advance to the next one
                        setPromptIndex((prev) => (prev + 1) % allSuggestions.length);
                        // Reset timer state so rotation resumes from a full cycle
                        remainingTimeRef.current = PROMPT_ROTATION_MS;
                        startTimeRef.current = Date.now();
                        // If for some reason we aren't hovering, we need to restart the actual timeout
                        if (!isHovering) {
                            startTimer(PROMPT_ROTATION_MS);
                        }
                    }}
                    onMouseEnter={() => {
                        // Clear any existing timeout to leave
                        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                        // Delay the "hover" state by 150ms to ignore accidental micro-movements
                        hoverTimeoutRef.current = setTimeout(() => {
                            setIsHovering(true);
                        }, 150);
                    }}
                    onMouseLeave={() => {
                        // Clear entrance timeout and set hover to false immediately
                        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                        setIsHovering(false);
                    }}
                >
                    <span
                        className={`prompt-suggestion-text ${isInitial && promptIndex === 0 ? 'is-initial' : ''}`}
                        key={promptIndex}
                    >
                        {allSuggestions[promptIndex]}
                    </span>
                </div>
            </div>

            {recentSessions.length > 0 && (
                <div className="recent-activity">
                    {recentSessions.map(s => (
                        <div
                            key={s.id}
                            className="recent-item"
                            onClick={() => handleSessionClick(s.id)}
                        >
                            <span className="status-icon codicon codicon-check"></span>
                            <span className="recent-title">{s.title}</span>
                            <span className="recent-time">
                                {s.timeAgo === 'spinner' ? (
                                    <span className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: '12px' }}></span>
                                ) : (
                                    s.timeAgo
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
