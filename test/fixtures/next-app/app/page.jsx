export default function Home({ posts }) {
  return (
    <section className="wrapper">
      {posts.length ? (
        <ul>
          {posts.map((post, i) => (
            <li key={post.id} data-i={i}>
              {post.title}
            </li>
          ))}
        </ul>
      ) : (
        <p>Empty</p>
      )}
      {posts.length && <p className="hint">Showing list</p>}
    </section>
  );
}
