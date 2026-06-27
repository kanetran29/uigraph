import React from "react";
import { Switch, Route, withRouter } from "react-router-dom";
import Login from "pages/Login";
import Register from "pages/Register";
import Home from "pages/Home";

class App extends React.Component {
  render() {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/" component={Home} />
      </Switch>
    );
  }
}

export default withRouter(App);
