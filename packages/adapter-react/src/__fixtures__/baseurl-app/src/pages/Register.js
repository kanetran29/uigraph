import React from "react";
import { withRouter, Link } from "react-router-dom";

class Register extends React.Component {
  handleSubmitForm = e => {
    e.preventDefault();
    this.props.authStore.register().then(() => this.props.history.replace("/"));
  };

  render() {
    return (
      <div>
        <Link to="login">Have an account?</Link>
        <form onSubmit={this.handleSubmitForm}>
          <button type="submit">Sign up</button>
        </form>
      </div>
    );
  }
}

export default withRouter(Register);
