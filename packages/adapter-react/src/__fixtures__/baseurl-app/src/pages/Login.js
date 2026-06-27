import React from "react";
import { withRouter, Link } from "react-router-dom";

class Login extends React.Component {
  handleSubmitForm = e => {
    e.preventDefault();
    this.props.authStore.login().then(() => this.props.history.replace("/"));
  };

  render() {
    return (
      <div>
        <Link to="register">Need an account?</Link>
        <form onSubmit={this.handleSubmitForm}>
          <input type="email" />
          <button type="submit">Sign in</button>
        </form>
      </div>
    );
  }
}

export default withRouter(Login);
