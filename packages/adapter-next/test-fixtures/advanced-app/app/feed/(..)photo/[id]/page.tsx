export default function PhotoModal({ params }: { params: { id: string } }) {
  return <dialog open>Photo {params.id} in a modal</dialog>
}
