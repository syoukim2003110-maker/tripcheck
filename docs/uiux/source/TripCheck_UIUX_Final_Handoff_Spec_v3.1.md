# TripCheck UI/UX Final Handoff Specification v3.1

## Purpose

This document is the final UI/UX direction for TripCheck.

The attached reference images represent the target product feeling.

TripCheck should not feel like: - a feasibility checker - an
administration dashboard - a travel database

TripCheck should feel like: - Apple Maps × Airbnb × Linear - a personal
travel concierge - a service that turns vague wishes into a finished
trip

------------------------------------------------------------------------

# Core Experience

User input:

"Here are places I want to visit."

TripCheck output:

-   Which day to visit
-   Best order
-   Route
-   Hotel area
-   Meals
-   Cafes
-   Small stops between destinations

The user should not plan. The user should approve and adjust.

------------------------------------------------------------------------

# Visual Direction

## Reference

The attached screenshots are the primary visual reference.

Important characteristics:

-   Large whitespace
-   Calm and premium appearance
-   Strong visual hierarchy
-   Timeline as the center
-   Map as an interactive companion
-   Recommendations embedded into the journey

------------------------------------------------------------------------

# Screen Structure

## Input Screen

Goal:

User understands within 5 seconds.

Display:

-   Wishlist input
-   Number of travel days
-   Create button

Avoid:

-   Technical explanations
-   Internal settings
-   Complex options

------------------------------------------------------------------------

# Result Screen

The first thing users see:

Example:

"4日なら、無理なく回れます"

Summary:

-   Number of spots
-   Travel time
-   Available buffer

Then immediately:

Day-by-day itinerary.

------------------------------------------------------------------------

# Timeline

Timeline is the main product component.

Each item:

-   Time
-   Location
-   Image
-   Stay duration
-   Movement
-   Recommendation

Example:

09:15 Lauterbrunnen

↓

12:05 Jungfraujoch

↓

12:45 Recommended lunch

------------------------------------------------------------------------

# Map

Map supports understanding.

Required:

-   Day color routes
-   Numbered locations
-   Selected location focus
-   Hotel marker
-   Restaurant marker
-   Cafe marker

The map must never replace the itinerary.

------------------------------------------------------------------------

# Recommendation Design

Recommendations are not search results.

They fill gaps in the itinerary.

## Restaurant

Show:

-   Why this place
-   Detour time
-   Rating
-   Open status

Example:

"Route +4 min"

------------------------------------------------------------------------

## Hotel

Do not show lists.

Show:

"This hotel fits this trip"

Explain:

-   Reduced travel time
-   Better access
-   Convenience

------------------------------------------------------------------------

## Cafe / Small Stops

Recommend based on:

-   Remaining time
-   Route direction
-   Location
-   Experience value

------------------------------------------------------------------------

# Component Direction

Required components:

-   TripSummaryCard
-   ItineraryTimeline
-   DayTimeline
-   ActivityCard
-   MovementCard
-   RecommendationCard
-   HotelRecommendationCard
-   MealRecommendationCard
-   TripMap
-   LocationDetailSheet

------------------------------------------------------------------------

# Design Principles

## Hide complexity, show confidence

Internal: - API - evidence - provider - calculation details

should stay hidden.

User needs:

-   Can I do this?
-   Why this recommendation?
-   What should I change?

------------------------------------------------------------------------

# Final Goal

TripCheck should make users think:

"I only entered places. The trip was already planned."

The engine can be extremely complex.

The experience must feel extremely simple.
