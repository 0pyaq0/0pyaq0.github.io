import React, { useState, useEffect } from "react"
import styled from "styled-components"

import { Link } from "gatsby"

import Title from "components/Title"
import Divider from "components/Divider"
import TagList from "components/TagList"
import Pagination from "components/Pagination"

const PostListWrapper = styled.div`
  @media (max-width: 768px) {
    padding: 0 10px;
  }
`

const PostWrapper = styled.div`
  position: relative;
  top: 0;
  transition: all 0.5s;

  @media (max-width: 768px) {
    padding: 0 5px;
  }
`

const Date = styled.p`
  margin-bottom: 16px;
  font-size: 14.4px;
  color: ${props => props.theme.colors.tertiaryText};
`

const Excerpt = styled.p`
  margin-bottom: 32px;
  line-height: 1.7;
  font-size: 15px;
  color: ${props => props.theme.colors.secondaryText};
  word-break: break-all;
`

export const POSTS_PER_PAGE = 10

// currentPage/numPages가 주어지면 이미 잘린 목록으로 보고 페이지 링크를 쓰고,
// 아니면(태그·검색·시리즈) 받은 목록을 10개씩 나눠 화면 안에서 넘긴다.
const PostList = ({ postList, currentPage, numPages, getPagePath }) => {
  const isPaged = numPages !== undefined
  const [localPage, setLocalPage] = useState(1)

  useEffect(() => {
    setLocalPage(1)
  }, [postList])

  const page = isPaged ? currentPage : localPage
  const totalPages = isPaged
    ? numPages
    : Math.ceil(postList.length / POSTS_PER_PAGE)
  const visiblePosts = isPaged
    ? postList
    : postList.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE)

  const handlePageChange = nextPage => {
    setLocalPage(nextPage)
    window.scrollTo({ top: 0 })
  }

  return (
    <PostListWrapper>
      {visiblePosts.map((post, i) => {
        const { title, date, tags } = post.frontmatter
        const { excerpt } = post
        const { slug } = post.fields

        return (
          <React.Fragment key={JSON.stringify({ slug, date })}>
            <PostWrapper>
              <Title size="bg">
                <Link to={slug}>{title}</Link>
              </Title>
              <Date>{date}</Date>
              <Excerpt>{excerpt}</Excerpt>
              <TagList tagList={tags} />
            </PostWrapper>

            {visiblePosts.length - 1 !== i && <Divider mt="48px" mb="32px" />}
          </React.Fragment>
        )
      })}

      <Pagination
        currentPage={page}
        numPages={totalPages}
        getPagePath={isPaged ? getPagePath : undefined}
        onPageChange={handlePageChange}
      />
    </PostListWrapper>
  )
}

export default PostList
