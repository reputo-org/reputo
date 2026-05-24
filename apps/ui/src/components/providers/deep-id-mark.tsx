"use client"

import { useId } from "react"
import { cn } from "@/lib/utils"

interface DeepIdMarkProps {
  /** Render height in pixels; width is auto-computed to preserve aspect ratio. */
  height?: number
  className?: string
}

const NATIVE_WIDTH = 136
const NATIVE_HEIGHT = 22

/**
 * DeepID brand wordmark, inlined so it renders without depending on a
 * /public asset (and so each instance can scope its gradient ids via useId,
 * preventing clashes when multiple instances render on the same page).
 *
 * The "ID" portion uses fill="white" per the brand asset, so this mark must
 * be rendered on a dark background (e.g. the primary Button variant).
 */
export function DeepIdMark({ height = 14, className }: DeepIdMarkProps) {
  const baseId = useId()
  const id = (n: number) => `${baseId}-paint${n}`
  const width = Math.round((NATIVE_WIDTH / NATIVE_HEIGHT) * height)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${NATIVE_WIDTH} ${NATIVE_HEIGHT}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("inline-block size-auto shrink-0", className)}
      role="img"
      aria-label="DeepID"
    >
      <path
        d="M11.007 3.73528H3.65259V13.5141H11.3743C12.4501 13.5141 13.0198 12.6635 13.2743 11.6683C13.5982 10.404 13.4362 7.01901 13.3351 6.04113C13.1933 4.68713 12.4269 3.92624 11.0098 3.73528M1.34478 0.101495H11.4553C14.3617 0.101495 16.6059 1.92707 17.0744 4.05064C17.4706 5.85596 17.7569 10.6412 17.0744 13.8556C16.7678 15.2992 14.7493 17.2608 11.4553 17.2608H1.78147C1.25223 17.2115 0.824219 17.0409 0.503206 16.7197C0.199546 16.4189 0.0404747 15.9993 0.0404747 15.5683L0 1.71587C0 1.56831 0.0173407 1.42077 0.0607209 1.27901C0.24581 0.700379 0.786614 0.306902 1.34478 0.0957031"
        fill={`url(#${id(0)})`}
      />
      <path
        d="M35.9968 3.66273H21.4789C20.9411 3.66273 20.5015 3.22296 20.5015 2.68484V0.977885C20.5015 0.439759 20.9411 0 21.4789 0H35.9968C36.5347 0 36.9743 0.439759 36.9743 0.977885V2.68484C36.9743 3.22296 36.5347 3.66273 35.9968 3.66273Z"
        fill={`url(#${id(1)})`}
      />
      <path
        d="M35.9968 10.4415H21.4789C20.9411 10.4415 20.5015 10.0018 20.5015 9.46368V7.75671C20.5015 7.21857 20.9411 6.77881 21.4789 6.77881H35.9968C36.5347 6.77881 36.9743 7.21857 36.9743 7.75671V9.46368C36.9743 10.0018 36.5347 10.4415 35.9968 10.4415Z"
        fill={`url(#${id(2)})`}
      />
      <path
        d="M35.9968 17.2204H21.4789C20.9411 17.2204 20.5015 16.7806 20.5015 16.2425V14.5356C20.5015 13.9974 20.9411 13.5576 21.4789 13.5576H35.9968C36.5347 13.5576 36.9743 13.9974 36.9743 14.5356V16.2425C36.9743 16.7806 36.5347 17.2204 35.9968 17.2204Z"
        fill={`url(#${id(3)})`}
      />
      <path
        d="M55.489 3.66273H40.9711C40.4333 3.66273 39.9937 3.22296 39.9937 2.68484V0.977885C39.9937 0.439759 40.4333 0 40.9711 0H55.489C56.0269 0 56.4665 0.439759 56.4665 0.977885V2.68484C56.4665 3.22296 56.0269 3.66273 55.489 3.66273Z"
        fill={`url(#${id(4)})`}
      />
      <path
        d="M55.489 10.4415H40.9711C40.4333 10.4415 39.9937 10.0018 39.9937 9.46368V7.75671C39.9937 7.21857 40.4333 6.77881 40.9711 6.77881H55.489C56.0269 6.77881 56.4665 7.21857 56.4665 7.75671V9.46368C56.4665 10.0018 56.0269 10.4415 55.489 10.4415Z"
        fill={`url(#${id(5)})`}
      />
      <path
        d="M55.489 17.2204H40.9711C40.4333 17.2204 39.9937 16.7806 39.9937 16.2425V14.5356C39.9937 13.9974 40.4333 13.5576 40.9711 13.5576H55.489C56.0269 13.5576 56.4665 13.9974 56.4665 14.5356V16.2425C56.4665 16.7806 56.0269 17.2204 55.489 17.2204Z"
        fill={`url(#${id(6)})`}
      />
      <path
        d="M77.1212 3.40523C76.8149 1.96155 74.796 0 71.502 0H61.8282C61.8282 0 61.8109 0 61.8022 0C60.8276 0.0954739 60.0901 0.925805 60.0844 1.90658V2.08018L60.0815 2.75139V10.5195C60.0757 10.5629 60.0728 10.6092 60.0728 10.6554V16.216C60.0728 16.7542 60.5124 17.194 61.0503 17.194H62.7566C63.2945 17.194 63.7341 16.7542 63.7341 16.216V13.3142H71.502C74.4085 13.3142 76.6526 11.4887 77.1212 9.36509C77.5171 7.55979 77.8037 6.61952 77.1212 3.40523ZM73.3818 7.37752C73.2083 8.71412 72.4737 9.48951 71.0566 9.68045H65.5271L63.7341 9.68334V3.73505H65.5271V3.74663H71.4239C72.4997 3.74663 73.1649 4.58852 73.3847 5.59245C73.5062 6.14793 73.4426 6.93777 73.3847 7.37752H73.3818Z"
        fill={`url(#${id(7)})`}
      />
      <path
        d="M88.0156 16.7648V2.77515H90.561V16.7648H88.0156ZM92.4821 16.7648V2.77515H103.752C104.244 2.77515 104.697 2.8982 105.112 3.14432C105.526 3.39043 105.856 3.72074 106.103 4.13525C106.349 4.5368 106.472 4.9837 106.472 5.47592V14.064C106.472 14.5562 106.349 15.0096 106.103 15.4241C105.856 15.8257 105.526 16.1495 105.112 16.3956C104.697 16.6417 104.244 16.7648 103.752 16.7648H92.4821ZM95.2606 14.1806H103.635C103.7 14.1806 103.758 14.1612 103.81 14.1223C103.862 14.0705 103.888 14.0122 103.888 13.9474V5.5925C103.888 5.52774 103.862 5.47592 103.81 5.43706C103.758 5.38525 103.7 5.35934 103.635 5.35934H95.2606C95.1958 5.35934 95.1376 5.38525 95.0857 5.43706C95.0469 5.47592 95.0274 5.52774 95.0274 5.5925V13.9474C95.0274 14.0122 95.0469 14.0705 95.0857 14.1223C95.1376 14.1612 95.1958 14.1806 95.2606 14.1806Z"
        fill="white"
      />
      <defs>
        <linearGradient
          id={id(0)}
          x1="2.51605"
          y1="-0.621798"
          x2="12.9884"
          y2="17.5089"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F2A813" />
          <stop offset="1" stopColor="#CB4F9A" />
        </linearGradient>
        <linearGradient
          id={id(1)}
          x1="26.0685"
          y1="-2.80057"
          x2="31.4132"
          y2="6.45858"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#CB4F9A" />
          <stop offset="1" stopColor="#AE2AE2" />
        </linearGradient>
        <linearGradient
          id={id(2)}
          x1="26.0685"
          y1="3.98113"
          x2="31.4132"
          y2="13.2374"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#CB4F9A" />
          <stop offset="1" stopColor="#AE2AE2" />
        </linearGradient>
        <linearGradient
          id={id(3)}
          x1="26.0685"
          y1="10.76"
          x2="31.4132"
          y2="20.0162"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#CB4F9A" />
          <stop offset="1" stopColor="#AE2AE2" />
        </linearGradient>
        <linearGradient
          id={id(4)}
          x1="45.5578"
          y1="-2.80057"
          x2="50.9054"
          y2="6.45857"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#AE2AE2" />
          <stop offset="1" stopColor="#6F79F1" />
        </linearGradient>
        <linearGradient
          id={id(5)}
          x1="45.5578"
          y1="3.98113"
          x2="50.9054"
          y2="13.2374"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#AE2AE2" />
          <stop offset="1" stopColor="#6F79F1" />
        </linearGradient>
        <linearGradient
          id={id(6)}
          x1="45.5578"
          y1="10.76"
          x2="50.9054"
          y2="20.0162"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#AE2AE2" />
          <stop offset="1" stopColor="#6F79F1" />
        </linearGradient>
        <linearGradient
          id={id(7)}
          x1="62.5657"
          y1="-0.630706"
          x2="71.2816"
          y2="14.4569"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6F79F1" />
          <stop offset="1" stopColor="#37BFFE" />
        </linearGradient>
      </defs>
    </svg>
  )
}
