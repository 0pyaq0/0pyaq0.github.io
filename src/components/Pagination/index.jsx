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

const Pagination = ({ currentPage, numPages, getPagePath, onPageChange }) => {
  if (numPages <= 1) return null

  return (
    <PaginationWrapper aria-label="pagination">
      {Array.from({ length: numPages }, (_, i) => {
        const page = i + 1
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
    </PaginationWrapper>
  )
}

export default Pagination
