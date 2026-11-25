import React from "react"
import styled, { css } from "styled-components"
import { Link } from "gatsby"

const PaginationWrapper = styled.nav`
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 64px;
`

const itemStyle = css`
  min-width: 32px;
  padding: 4px 8px;
  background: none;
  border: none;
  font-size: 16px;
  text-align: center;
  text-decoration: none;
  color: ${props =>
    props.$active ? props.theme.colors.text : props.theme.colors.tertiaryText};
  font-weight: ${props => (props.$active ? "bold" : "normal")};
  text-decoration: ${props => (props.$active ? "underline" : "none")};
  text-underline-offset: 6px;
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: ${props => props.theme.colors.text};
  }
`

const PageLink = styled(Link)`
  ${itemStyle}
`

const PageButton = styled.button`
  ${itemStyle}
`

const arrowStyle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  padding: 4px 8px;
  background: none;
  border: none;
  color: ${props => props.theme.colors.tertiaryText};
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: ${props => props.theme.colors.text};
  }
`

const ArrowLink = styled(Link)`
  ${arrowStyle}
`

const ArrowButton = styled.button`
  ${arrowStyle}
`

const Chevron = ({ direction }) => (
  <svg
    width="10"
    height="16"
    viewBox="0 0 10 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {direction === "next" ? (
      <polyline points="2,2 8,8 2,14" />
    ) : (
      <polyline points="8,2 2,8 8,14" />
    )}
  </svg>
)

const GROUP_SIZE = 5

const Pagination = ({ currentPage, numPages, getPagePath, onPageChange }) => {
  if (numPages <= 1) return null

  const groupStart =
    Math.floor((currentPage - 1) / GROUP_SIZE) * GROUP_SIZE + 1
  const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, numPages)
  const prevPage = groupStart > 1 ? groupStart - 1 : null
  const nextPage = groupEnd < numPages ? groupEnd + 1 : null

  const renderArrow = (page, direction) => {
    const label = direction === "next" ? "다음 페이지 묶음" : "이전 페이지 묶음"
    return getPagePath ? (
      <ArrowLink key={direction} to={getPagePath(page)} aria-label={label}>
        <Chevron direction={direction} />
      </ArrowLink>
    ) : (
      <ArrowButton
        key={direction}
        type="button"
        onClick={() => onPageChange(page)}
        aria-label={label}
      >
        <Chevron direction={direction} />
      </ArrowButton>
    )
  }

  return (
    <PaginationWrapper aria-label="pagination">
      {prevPage && renderArrow(prevPage, "prev")}
      {Array.from({ length: groupEnd - groupStart + 1 }, (_, i) => {
        const page = groupStart + i
        const active = page === currentPage
        const ariaCurrent = active ? "page" : undefined

        return getPagePath ? (
          <PageLink
            key={page}
            to={getPagePath(page)}
            $active={active}
            aria-current={ariaCurrent}
          >
            {page}
          </PageLink>
        ) : (
          <PageButton
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            $active={active}
            aria-current={ariaCurrent}
          >
            {page}
          </PageButton>
        )
      })}
      {nextPage && renderArrow(nextPage, "next")}
    </PaginationWrapper>
  )
}

export default Pagination
