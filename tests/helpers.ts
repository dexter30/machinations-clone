import { Diagram, DiagramConnection, DiagramNode, NodeType, defaultConnection, defaultNode, emptyDiagram } from '../src/engine/types';

export class B {
  d: Diagram = emptyDiagram('test');
  private n = 0;
  node(type: NodeType, props: Partial<DiagramNode> = {}): string {
    const id = props.id ?? `n${++this.n}`;
    this.d.nodes.push({ ...defaultNode(type, id, 0, 0), ...props, id });
    return id;
  }
  res(from: string, to: string, formula = '', props: Partial<DiagramConnection> = {}): string {
    const id = `c${++this.n}`;
    this.d.connections.push({ ...defaultConnection('resource', id, from, to), formula, ...props });
    return id;
  }
  state(from: string, to: string, formula = '', props: Partial<DiagramConnection> = {}): string {
    const id = `c${++this.n}`;
    this.d.connections.push({ ...defaultConnection('state', id, from, to), formula, ...props });
    return id;
  }
}
