function Error({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ fontFamily: "system-ui", textAlign: "center", padding: "4rem" }}>
      <h1 style={{ fontSize: "2rem" }}>{statusCode ?? "Error"}</h1>
      <p style={{ color: "#666" }}>
        {statusCode === 404 ? "Page not found" : "Something went wrong"}
      </p>
    </div>
  );
}

Error.getInitialProps = ({ res, err }: any) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
