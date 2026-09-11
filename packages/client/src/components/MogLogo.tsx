import React from 'react';

interface MogLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

export const MogLogo: React.FC<MogLogoProps> = ({ 
  size = 36, 
  className = '',
  animated = false 
}) => {
  return (
    <div 
      className={`relative inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`w-full h-full ${animated ? 'transition-transform duration-200 hover:rotate-3' : ''}`}
      >
        {/* Hard Offset Drop Shadow */}
        <path
          d="M6 38L18 10L24 24L30 10L42 38H34L30 26L24 38L18 26L14 38H6Z"
          fill="#000000"
          transform="translate(3, 3)"
        />

        {/* Base Geometric 'M' Bridge Structure */}
        <path
          d="M6 38L18 10L24 24L30 10L42 38H34L30 26L24 38L18 26L14 38H6Z"
          fill="#FFC900"
          stroke="#000000"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />

        {/* Central Core Packet Node (Mint Green) */}
        <circle
          cx="24"
          cy="24"
          r="4"
          fill="#00F59B"
          stroke="#000000"
          strokeWidth="2.5"
        />

        {/* Center Transmission Spark */}
        {animated && (
          <circle
            cx="24"
            cy="24"
            r="7"
            stroke="#00F59B"
            strokeWidth="1.5"
            className="animate-ping opacity-75"
          />
        )}
      </svg>
    </div>
  );
};
