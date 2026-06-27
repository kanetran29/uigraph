import React from "react";
import { Link } from "react-router-dom";

class Home extends React.Component {
  render() {
    return (
      <div>
        <Link to="/login">Sign in</Link>
        <Link to="register">Sign up</Link>
      </div>
    );
  }
}

export default Home;
