import React from "react"
import _ from "lodash"
import { graphql } from "gatsby"

import Layout from "components/Layout"
import SEO from "components/SEO"
import Bio from "components/Bio"
import PostList from "components/PostList"
import SideTagList from "components/SideTagList"
import VerticalSpace from "components/VerticalSpace"
import Tab from "components/Tab"

import { title, description, siteUrl } from "../../blog-config"

const BlogIndex = ({ data, pageContext }) => {
  const posts = data.posts.nodes
  const { totalCount, group } = data.allMarkdownRemark
  const tags = _.sortBy(group, ["totalCount"]).reverse()
  const { currentPage, numPages } = pageContext

  if (posts.length === 0) {
    return (
      <p>
        No blog posts found. Add markdown posts to &quot;content/blog&quot; (or
        the directory you specified for the &quot;gatsby-source-filesystem&quot;
        plugin in gatsby-config.js).
      </p>
    )
  }

  return (
    <Layout>
      <SEO title={title} description={description} url={siteUrl} />
      <VerticalSpace size={48} />
      <Bio />
      <Tab postsCount={totalCount} activeTab="posts" />
      <SideTagList tags={tags} postCount={totalCount} />
      <PostList
        postList={posts}
        currentPage={currentPage}
        numPages={numPages}
        getPagePath={page => (page === 1 ? "/" : `/page/${page}/`)}
      />
    </Layout>
  )
}

export default BlogIndex

export const pageQuery = graphql`
  query ($skip: Int!, $limit: Int!) {
    allMarkdownRemark(
      filter: { fileAbsolutePath: { regex: "/contents/posts/" } }
    ) {
      totalCount
      group(field: frontmatter___tags) {
        fieldValue
        totalCount
      }
    }
    posts: allMarkdownRemark(
      sort: { fields: [frontmatter___date], order: DESC }
      filter: { fileAbsolutePath: { regex: "/contents/posts/" } }
      skip: $skip
      limit: $limit
    ) {
      nodes {
        excerpt(pruneLength: 200, truncate: true)
        fields {
          slug
        }
        frontmatter {
          date(formatString: "MMMM DD, YYYY")
          update(formatString: "MMM DD, YYYY")
          title
          tags
        }
      }
    }
  }
`
